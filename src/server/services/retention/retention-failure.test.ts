// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { runJob } from '../job-run.ts';
import { queuedJob, runWorld } from '../job-run-fixture/test-support.ts';
import { retentionSweepHandler } from './retention-handler.ts';
import { runRetentionSweep } from './retention-sweep.ts';
import {
  at,
  DAY,
  deliveryIds,
  failOnAudit,
  failOnBatch,
  insertDeliveries,
  insertSession,
  retentionWorld,
  sessionIds,
  sweptRows,
} from './test-support.ts';

// The failure of a batch (E22-S04): the batches that committed stay committed, the audit row says what they deleted, the error
// is the one thrown (for pg-boss to retry within its bounded retryLimit), and the log has no row data.

const REAL = { dryRun: false } as const;

/** What a PostgreSQL error looks like to the logger: a SQLSTATE, a severity and a `detail` that quotes the row. */
class QuotingDatabaseError extends Error {
  override readonly name = 'error';
  readonly code = '40001';
  readonly severity = 'ERROR';
  readonly detail = 'Key (delivery_id)=(zzzz-canary-delivery) is being deleted';

  constructor() {
    super('could not serialize access while deleting zzzz-canary-delivery');
  }
}

test('an error on the second batch leaves the first batch committed and is thrown as it is', async () => {
  const world = await retentionWorld({ batchSize: 2 });
  await insertDeliveries(world.db, 'old', 6, at(-31 * DAY));
  const failure = new QuotingDatabaseError();
  const deps = { ...world.deps, db: world.db.withPlugin(failOnBatch(2, failure)) };
  await expect(runRetentionSweep(deps, REAL)).rejects.toBe(failure);
  expect(await deliveryIds(world.db)).toEqual(['old-002', 'old-003', 'old-004', 'old-005']);
});

test('the audit row of a run that failed records what the batches that committed deleted', async () => {
  const world = await retentionWorld({ batchSize: 2 });
  await insertDeliveries(world.db, 'old', 6, at(-31 * DAY));
  const deps = { ...world.deps, db: world.db.withPlugin(failOnBatch(3, new QuotingDatabaseError())) };
  await expect(runRetentionSweep(deps, REAL)).rejects.toThrow('could not serialize');
  expect((await sweptRows(world.db)).map((row) => row.metadata)).toEqual([{ webhook_deliveries: 4, sessions: 0 }]);
});

test('a failure before anything was deleted writes no audit row', async () => {
  const world = await retentionWorld({ batchSize: 2 });
  await insertDeliveries(world.db, 'old', 3, at(-31 * DAY));
  const deps = { ...world.deps, db: world.db.withPlugin(failOnBatch(1, new QuotingDatabaseError())) };
  await expect(runRetentionSweep(deps, REAL)).rejects.toThrow('could not serialize');
  expect(await deliveryIds(world.db)).toHaveLength(3);
  expect(await sweptRows(world.db)).toEqual([]);
});

test('a failure while the sessions are purged keeps the deliveries gone and records both counts so far', async () => {
  const world = await retentionWorld({ batchSize: 1 });
  await insertDeliveries(world.db, 'old', 2, at(-31 * DAY));
  const sessions = [await insertSession(world, 1, at(-2 * DAY)), await insertSession(world, 2, at(-2 * DAY))];
  // With one row a batch: two deliveries, a third batch that finds none, then the first session; the fifth batch is the second session.
  const deps = { ...world.deps, db: world.db.withPlugin(failOnBatch(5, new QuotingDatabaseError())) };
  await expect(runRetentionSweep(deps, REAL)).rejects.toThrow('could not serialize');
  expect(await deliveryIds(world.db)).toEqual([]);
  const left = await sessionIds(world.db);
  expect(left).toHaveLength(1);
  expect(sessions).toContain(left[0]);
  expect((await sweptRows(world.db)).map((row) => row.metadata)).toEqual([{ webhook_deliveries: 2, sessions: 1 }]);
});

test('when the audit row cannot be written either, the error that is thrown is the one of the batch', async () => {
  const world = await retentionWorld({ batchSize: 2 });
  await insertDeliveries(world.db, 'old', 6, at(-31 * DAY));
  const failure = new QuotingDatabaseError();
  const db = world.db.withPlugin(failOnBatch(2, failure)).withPlugin(failOnAudit(new Error('the audit insert failed')));
  await expect(runRetentionSweep({ ...world.deps, db }, REAL)).rejects.toBe(failure);
  expect(await sweptRows(world.db)).toEqual([]);
});

test('a run that deleted everything but cannot write its audit row fails: the queue retries it, and the retry finds nothing', async () => {
  const world = await retentionWorld();
  await insertDeliveries(world.db, 'old', 2, at(-31 * DAY));
  const broken = { ...world.deps, db: world.db.withPlugin(failOnAudit(new Error('the audit insert failed'))) };
  await expect(runRetentionSweep(broken, REAL)).rejects.toThrow('the audit insert failed');
  expect(await deliveryIds(world.db)).toEqual([]);
  expect(await runRetentionSweep(world.deps, REAL)).toEqual({ webhook_deliveries: 0, sessions: 0 });
});

test('the next run after a failure continues where it stopped, and the audit rows add up to what was deleted', async () => {
  const world = await retentionWorld({ batchSize: 2 });
  await insertDeliveries(world.db, 'old', 7, at(-31 * DAY));
  const deps = { ...world.deps, db: world.db.withPlugin(failOnBatch(3, new QuotingDatabaseError())) };
  await expect(runRetentionSweep(deps, REAL)).rejects.toThrow('could not serialize');
  expect(await runRetentionSweep(world.deps, REAL)).toEqual({ webhook_deliveries: 3, sessions: 0 });
  expect(await deliveryIds(world.db)).toEqual([]);
  expect((await sweptRows(world.db)).map((row) => row.metadata)).toEqual([
    { webhook_deliveries: 4, sessions: 0 },
    { webhook_deliveries: 3, sessions: 0 },
  ]);
});

test('the log of a job that failed on its second batch names the job and the error code and holds no row data', async () => {
  const world = await retentionWorld({ batchSize: 2 });
  await insertDeliveries(world.db, 'zzzz-old', 6, at(-31 * DAY));
  const deps = { ...world.deps, db: world.db.withPlugin(failOnBatch(2, new QuotingDatabaseError())) };
  const run = runWorld((registry) => {
    registry.register('retention-sweep', retentionSweepHandler(deps));
  });
  await expect(runJob('retention-sweep', queuedJob({ type: 'retention-sweep' }), run.deps)).rejects.toThrow(
    'could not serialize',
  );
  const failed = run.logs.lines().filter((line) => line['msg'] === 'job.failed');
  expect(failed).toEqual([expect.objectContaining({ type: 'retention-sweep', level: 40 })]);
  expect(JSON.stringify(failed)).toContain('40001');
  expect(run.logs.text()).not.toContain('zzzz');
});
