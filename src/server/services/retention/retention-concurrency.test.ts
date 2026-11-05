// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import {
  backendPid,
  migratedTestDatabase,
  realPostgresOnly,
  waitUntilBlocked,
  withConnections,
} from '../../adapters/db/test-support.ts';
import { deliveryIdSchema } from '../../domain/delivery-id.ts';
import { type Job, jobSchema } from '../../domain/jobs.ts';
import { createJobsTable, deliveryRows, fakeEnqueuer, sentJobs } from '../jobs-fixture/test-support.ts';
import { FakeClock } from '../test-support.ts';
import { createWebhookDeliveries } from '../webhook-deliveries.ts';
import { deleteBatch, WEBHOOK_DELIVERIES } from './retention-queries.ts';
import { runRetentionSweep } from './retention-sweep.ts';
import {
  at,
  DAY,
  DELIVERY_CUTOFF,
  deliveryIds,
  insertDeliveries,
  insertDelivery,
  NOW_TEXT,
  sweptRows,
} from './test-support.ts';

// The retention sweep next to the webhook intake and next to itself, on a real PostgreSQL (E22-S04). PGlite has one session, so it
// cannot show a row lock, a unique-index wait or two batches that run at once. Each test holds a batch open in one session, as
// the sweep has it between its DELETE and its COMMIT, and lets another session meet it. Skipped on PGlite, run by the CI
// `postgres` job.

const OLD = '5b8f2c1e-3d4a-4f6b-9a7c-0e1d2f3a4b5c';
const FRESH = '0f1e2d3c-4b5a-4968-8776-655443322110';
const SUBJECT = { deliveryId: deliveryIdSchema.parse(OLD), event: 'installation', action: 'created' };
const JOB: Job = {
  type: 'sync-installation',
  githubInstallationId: parseGithubId(31_001),
  deliveryId: deliveryIdSchema.parse(OLD),
};
const SETTINGS = { webhookDeliveriesDays: 30, batchSize: 5000 };
const sweepOver = (db: Parameters<typeof runRetentionSweep>[0]['db']) =>
  runRetentionSweep({ db, clock: new FakeClock(NOW_TEXT), settings: SETTINGS }, { dryRun: false });

test('the job the intake sends in these tests is a job of the catalogue, and the ids are those of deliveries', () => {
  expect(jobSchema.parse(JOB)).toEqual(JOB);
  expect([deliveryIdSchema.parse(OLD), deliveryIdSchema.parse(FRESH)]).toEqual([OLD, FRESH]);
});

/** A migrated database with the table of the fake queue, one delivery GitHub sent a month ago and that was processed, and three connections. */
async function scene() {
  const { db } = await migratedTestDatabase();
  await createJobsTable(db);
  await insertDelivery(db, OLD, at(-31 * DAY));
  const connections = withConnections(3);
  return { db, holder: connections.get(0), other: connections.get(1), observer: connections.get(2) };
}

type Scene = Awaited<ReturnType<typeof scene>>;

/** The batch of the sweep between its DELETE and its COMMIT: a transaction of `holder` that has deleted the old delivery. */
async function openBatch({ holder }: Scene): Promise<void> {
  await sql`begin`.execute(holder);
  expect(await deleteBatch(holder, WEBHOOK_DELIVERIES, DELIVERY_CUTOFF, 5000)).toBe(1);
}

/**
 * GitHub sends delivery `OLD` again while the batch that deletes it is open: the intake waits behind the batch, and `end` ends the
 * batch. Resolves to the answer of the intake and the jobs it sent.
 */
async function redeliveredDuringTheBatch(world: Scene, end: 'commit' | 'rollback') {
  const enqueuer = fakeEnqueuer();
  const intake = createWebhookDeliveries({ db: world.other, enqueuer });
  const waiter = await backendPid(world.other);
  await openBatch(world);
  const redelivery = intake.record(SUBJECT, JOB);
  await waitUntilBlocked(world.observer, waiter);
  expect(enqueuer.calls).toHaveLength(0);
  await (end === 'commit' ? sql`commit` : sql`rollback`).execute(world.holder);
  return { answer: await redelivery, sent: (await sentJobs(world.db)).map((sent) => sent.idempotencyKey) };
}

realPostgresOnly(
  'a redelivery that reuses the id of a delivery the sweep is deleting waits for the batch to commit, then is recorded as new and its job sent',
  async () => {
    const world = await scene();
    expect(await redeliveredDuringTheBatch(world, 'commit')).toEqual({ answer: 'accepted', sent: [OLD] });
    expect(await deliveryRows(world.db)).toMatchObject([{ delivery_id: OLD, processed_at: null }]);
  },
);

realPostgresOnly(
  'when the batch rolls back instead, the redelivery meets the row that stayed and is a duplicate: nothing is lost and nothing is sent twice',
  async () => {
    const world = await scene();
    expect(await redeliveredDuringTheBatch(world, 'rollback')).toEqual({ answer: 'duplicate', sent: [] });
    expect(await deliveryIds(world.db)).toEqual([OLD]);
  },
);

realPostgresOnly(
  'a delivery recorded while a batch is open is not held up by it, is not in the batch, and is there after the commit',
  async () => {
    const world = await scene();
    const intake = createWebhookDeliveries({ db: world.other, enqueuer: fakeEnqueuer() });
    await openBatch(world);
    const fresh = deliveryIdSchema.parse(FRESH);
    expect(await intake.record({ ...SUBJECT, deliveryId: fresh }, { ...JOB, deliveryId: fresh })).toBe('accepted');
    await sql`commit`.execute(world.holder);
    expect(await deliveryIds(world.db)).toEqual([FRESH]);
    expect((await sentJobs(world.db)).map((sent) => sent.idempotencyKey)).toEqual([FRESH]);
  },
);

realPostgresOnly(
  'a row another session has locked is skipped and not waited for, and the next run deletes it',
  async () => {
    const { db, holder, other, observer } = await scene();
    await insertDeliveries(db, 'zzzz-second', 1, at(-40 * DAY));
    await sql`begin`.execute(holder);
    await sql`select 1 from webhook_deliveries where delivery_id = ${OLD} for update`.execute(holder);
    expect(await sweepOver(other)).toEqual({ webhook_deliveries: 1, sessions: 0 });
    expect(await deliveryIds(db)).toEqual([OLD]);
    await sql`commit`.execute(holder);
    expect(await sweepOver(observer)).toEqual({ webhook_deliveries: 1, sessions: 0 });
    expect(await deliveryIds(db)).toEqual([]);
    expect((await sweptRows(db)).map((row) => row.metadata)).toEqual([
      { webhook_deliveries: 1, sessions: 0 },
      { webhook_deliveries: 1, sessions: 0 },
    ]);
  },
);

realPostgresOnly(
  'two sweeps at once, in small batches, delete every row exactly once between them and neither waits for the other',
  async () => {
    const { db, holder, other } = await scene();
    await insertDeliveries(db, 'zzzz-many', 89, at(-45 * DAY));
    const settings = { ...SETTINGS, batchSize: 3 };
    const run = (handle: typeof holder) =>
      runRetentionSweep({ db: handle, clock: new FakeClock(NOW_TEXT), settings }, { dryRun: false });
    const counts = await Promise.all([run(holder), run(other)]);
    expect(counts.reduce((sum, one) => sum + one.webhook_deliveries, 0)).toBe(90);
    expect(await deliveryIds(db)).toEqual([]);
    const audited = (await sweptRows(db)).reduce((sum, row) => sum + Number(row.metadata['webhook_deliveries']), 0);
    expect(audited).toBe(90);
  },
);
