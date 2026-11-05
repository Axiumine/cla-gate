// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test, vi } from 'vitest';
import { runRetentionSweep } from './retention-sweep.ts';
import {
  at,
  DAY,
  DELIVERY_CUTOFF,
  deliveryIds,
  insertDeliveries,
  insertDelivery,
  insertSession,
  NOW,
  retentionWorld,
  SECOND,
  SESSION_CUTOFF,
  sessionIds,
  sweptRows,
} from './test-support.ts';

// What the retention sweep deletes and what it keeps (E22-S04): the boundary, the pending rows, the live sessions, the batches,
// the second run, the audit row and the dry run. The tables it must not touch, the failure of a batch and the runtime role are
// in the files next to this one.

const REAL = { dryRun: false } as const;
const DRY = { dryRun: true } as const;

test('a delivery processed exactly at the cutoff is kept and one processed a second before it is deleted', async () => {
  const { db, deps } = await retentionWorld();
  await insertDelivery(db, 'at-the-cutoff', DELIVERY_CUTOFF);
  await insertDelivery(db, 'one-second-older', new Date(DELIVERY_CUTOFF.getTime() - SECOND));
  await insertDelivery(db, 'one-second-newer', new Date(DELIVERY_CUTOFF.getTime() + SECOND));
  expect(await runRetentionSweep(deps, REAL)).toEqual({ webhook_deliveries: 1, sessions: 0 });
  expect(await deliveryIds(db)).toEqual(['at-the-cutoff', 'one-second-newer']);
});

test('the retention in days is the setting: 7 days keeps a delivery processed 6 days ago and deletes one processed 8 days ago', async () => {
  const { db, deps } = await retentionWorld({ webhookDeliveriesDays: 7 });
  await insertDelivery(db, 'six-days', at(-6 * DAY));
  await insertDelivery(db, 'eight-days', at(-8 * DAY));
  await runRetentionSweep(deps, REAL);
  expect(await deliveryIds(db)).toEqual(['six-days']);
});

test('a delivery with processed_at null is pending work and is kept whatever its age', async () => {
  const { db, deps } = await retentionWorld();
  await db
    .insertInto('webhook_deliveries')
    .values({ delivery_id: 'pending-for-a-year', event: 'pull_request', action: 'opened', received_at: at(-365 * DAY) })
    .execute();
  await insertDelivery(db, 'processed-long-ago', at(-365 * DAY));
  expect(await runRetentionSweep(deps, REAL)).toEqual({ webhook_deliveries: 1, sessions: 0 });
  expect(await deliveryIds(db)).toEqual(['pending-for-a-year']);
});

test('a delivery that arrived long ago and was processed recently is kept: the age is the time since it was processed', async () => {
  const { db, deps } = await retentionWorld();
  await db
    .insertInto('webhook_deliveries')
    .values({
      delivery_id: 'late',
      event: 'pull_request',
      action: null,
      received_at: at(-90 * DAY),
      processed_at: at(-DAY),
    })
    .execute();
  await runRetentionSweep(deps, REAL);
  expect(await deliveryIds(db)).toEqual(['late']);
});

test('a session that died exactly one day ago is kept and one that died a second earlier is deleted', async () => {
  const world = await retentionWorld();
  const kept = await insertSession(world, 1, SESSION_CUTOFF);
  const gone = await insertSession(world, 2, new Date(SESSION_CUTOFF.getTime() - SECOND), at(DAY));
  expect(await runRetentionSweep(world.deps, REAL)).toEqual({ webhook_deliveries: 0, sessions: 1 });
  expect(await sessionIds(world.db)).toEqual([kept]);
  expect(await sessionIds(world.db)).not.toContain(gone);
});

test('a session that is still valid is never deleted, nor one that died less than a day ago', async () => {
  const world = await retentionWorld();
  const valid = await insertSession(world, 1, at(SECOND), at(7 * DAY));
  const validIdleLong = await insertSession(world, 2, at(DAY), at(60 * DAY));
  const diedHoursAgo = await insertSession(world, 3, at(-12 * 3600 * SECOND), at(DAY));
  expect(await runRetentionSweep(world.deps, REAL)).toEqual({ webhook_deliveries: 0, sessions: 0 });
  expect(await sessionIds(world.db)).toEqual([valid, validIdleLong, diedHoursAgo]);
});

test('a session whose idle expiry passed more than a day ago is deleted although its absolute expiry has not', async () => {
  const world = await retentionWorld();
  await insertSession(world, 1, at(-2 * DAY), at(5 * DAY));
  expect(await runRetentionSweep(world.deps, REAL)).toEqual({ webhook_deliveries: 0, sessions: 1 });
  expect(await sessionIds(world.db)).toEqual([]);
});

test('a session whose absolute expiry passed more than a day ago is deleted even where the idle expiry says otherwise', async () => {
  const world = await retentionWorld();
  // The table checks that the idle expiry is never after the absolute one, and `slide` keeps it so. The condition names both
  // anyway, so a row that broke the rule would still go: drop the check in this throw-away database to prove it.
  await sql`alter table sessions drop constraint sessions_check`.execute(world.db);
  await insertSession(world, 1, at(10 * DAY), at(-2 * DAY));
  expect(await runRetentionSweep(world.deps, REAL)).toEqual({ webhook_deliveries: 0, sessions: 1 });
});

test('the rows are deleted in batches of the configured size, each batch in a transaction of its own, until a batch comes up short', async () => {
  const { db, deps } = await retentionWorld({ batchSize: 2 });
  await insertDeliveries(db, 'old', 5, at(-40 * DAY));
  const transaction = vi.spyOn(db, 'transaction');
  expect(await runRetentionSweep(deps, REAL)).toEqual({ webhook_deliveries: 5, sessions: 0 });
  // Deliveries: 2, 2, 1 (the short one ends it); sessions: 0 (one empty batch); the audit row: one more.
  expect(transaction).toHaveBeenCalledTimes(3 + 1 + 1);
  expect(await deliveryIds(db)).toEqual([]);
});

test('a backlog that is an exact multiple of the batch size ends with one more batch that finds nothing', async () => {
  const world = await retentionWorld({ batchSize: 2 });
  await insertDeliveries(world.db, 'old', 4, at(-40 * DAY));
  await insertSession(world, 1, at(-3 * DAY));
  await insertSession(world, 2, at(-3 * DAY));
  const transaction = vi.spyOn(world.db, 'transaction');
  expect(await runRetentionSweep(world.deps, REAL)).toEqual({ webhook_deliveries: 4, sessions: 2 });
  expect(transaction).toHaveBeenCalledTimes(3 + 2 + 1);
});

test('a second run right after the first deletes nothing and writes no audit row', async () => {
  const world = await retentionWorld({ batchSize: 3 });
  await insertDeliveries(world.db, 'old', 7, at(-31 * DAY));
  await insertSession(world, 1, at(-2 * DAY));
  expect(await runRetentionSweep(world.deps, REAL)).toEqual({ webhook_deliveries: 7, sessions: 1 });
  expect(await runRetentionSweep(world.deps, REAL)).toEqual({ webhook_deliveries: 0, sessions: 0 });
  expect(await sweptRows(world.db)).toHaveLength(1);
});

test('a run that deleted something writes one audit row, retention.swept, with no actor, no installation and the two counts', async () => {
  const world = await retentionWorld({ batchSize: 2 });
  await insertDeliveries(world.db, 'old', 5, at(-31 * DAY));
  await insertSession(world, 1, at(-2 * DAY));
  await insertSession(world, 2, at(-3 * DAY));
  await runRetentionSweep(world.deps, REAL);
  expect(await sweptRows(world.db)).toEqual([
    {
      action: 'retention.swept',
      installation_id: null,
      actor_github_id: null,
      subject_type: null,
      subject_id: null,
      metadata: { webhook_deliveries: 5, sessions: 2 },
    },
  ]);
});

test('a run that deleted only sessions, or only deliveries, still writes its row, with a zero for the other', async () => {
  const world = await retentionWorld();
  await insertSession(world, 1, at(-2 * DAY));
  await runRetentionSweep(world.deps, REAL);
  await insertDelivery(world.db, 'old', at(-31 * DAY));
  await runRetentionSweep(world.deps, REAL);
  expect((await sweptRows(world.db)).map((row) => row.metadata)).toEqual([
    { webhook_deliveries: 0, sessions: 1 },
    { webhook_deliveries: 1, sessions: 0 },
  ]);
});

test('an empty run writes no audit row', async () => {
  const world = await retentionWorld();
  await insertDelivery(world.db, 'recent', at(-DAY));
  expect(await runRetentionSweep(world.deps, REAL)).toEqual({ webhook_deliveries: 0, sessions: 0 });
  expect(await sweptRows(world.db)).toEqual([]);
});

test('a dry run counts what a run would delete, deletes nothing and writes no audit row', async () => {
  const world = await retentionWorld({ batchSize: 2 });
  await insertDeliveries(world.db, 'old', 5, at(-31 * DAY));
  await insertDelivery(world.db, 'pending-ish', at(-29 * DAY));
  await insertSession(world, 1, at(-2 * DAY));
  await insertSession(world, 2, at(SECOND), at(DAY));
  const before = { deliveries: await deliveryIds(world.db), sessions: await sessionIds(world.db) };
  const transaction = vi.spyOn(world.db, 'transaction');
  expect(await runRetentionSweep(world.deps, DRY)).toEqual({ webhook_deliveries: 5, sessions: 1 });
  expect(transaction).not.toHaveBeenCalled();
  expect({ deliveries: await deliveryIds(world.db), sessions: await sessionIds(world.db) }).toEqual(before);
  expect(await sweptRows(world.db)).toEqual([]);
  // The count is exactly what the run then deletes.
  expect(await runRetentionSweep(world.deps, REAL)).toEqual({ webhook_deliveries: 5, sessions: 1 });
});

test('a dry run on an empty database counts zero', async () => {
  const { deps } = await retentionWorld();
  expect(await runRetentionSweep(deps, DRY)).toEqual({ webhook_deliveries: 0, sessions: 0 });
});

test('the cutoffs come from the clock of the run, read once: moving the clock moves what is due', async () => {
  const world = await retentionWorld();
  await insertDelivery(world.db, 'twenty-nine-days', at(-29 * DAY));
  expect(await runRetentionSweep(world.deps, REAL)).toEqual({ webhook_deliveries: 0, sessions: 0 });
  world.clock.advance(2 * DAY);
  expect(await runRetentionSweep(world.deps, REAL)).toEqual({ webhook_deliveries: 1, sessions: 0 });
  expect(world.clock.now().getTime()).toBe(NOW.getTime() + 2 * DAY);
});

test('a signal that has aborted stops the run before its first batch, and nothing is deleted or recorded', async () => {
  const world = await retentionWorld();
  await insertDelivery(world.db, 'old', at(-31 * DAY));
  const controller = new AbortController();
  controller.abort(new Error('shutdown'));
  await expect(runRetentionSweep(world.deps, { dryRun: false, signal: controller.signal })).rejects.toThrow('shutdown');
  expect(await deliveryIds(world.db)).toEqual(['old']);
  expect(await sweptRows(world.db)).toEqual([]);
});

test('a signal that aborts between two batches stops the run there: what the first batch deleted stays deleted and is recorded', async () => {
  const world = await retentionWorld({ batchSize: 2 });
  await insertDeliveries(world.db, 'old', 6, at(-31 * DAY));
  const controller = new AbortController();
  const transaction = vi.spyOn(world.db, 'transaction');
  transaction.mockImplementationOnce(() => {
    controller.abort(new Error('shutdown'));
    return world.db.transaction();
  });
  await expect(runRetentionSweep(world.deps, { dryRun: false, signal: controller.signal })).rejects.toThrow('shutdown');
  expect(await deliveryIds(world.db)).toEqual(['old-002', 'old-003', 'old-004', 'old-005']);
  expect((await sweptRows(world.db)).map((row) => row.metadata)).toEqual([{ webhook_deliveries: 2, sessions: 0 }]);
});
