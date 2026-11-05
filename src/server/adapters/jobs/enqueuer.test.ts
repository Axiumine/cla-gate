// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Transaction } from 'kysely';
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { type Job, jobSchema } from '../../domain/jobs.ts';
import type { EnqueueOptions } from '../../services/ports/jobs.ts';
import type { Database } from '../db/schema.ts';
import { migratedTestDatabase } from '../db/test-support.ts';
import { PgBossEnqueuer } from './enqueuer.ts';
import { jobIdFor } from './job-id.ts';
import { QUEUES } from './queues.ts';
import { fakeBoss } from './test-support.ts';

// The adapter with a pg-boss that is only a script (E07-S01): what it asks of pg-boss and what it answers. The behaviour
// against a real queue is the contract suite in enqueuer-contract.test.ts.

const GUID = '5b8f2c1e-3d4a-4f6b-9a7c-0e1d2f3a4b5c';
const JOB: Job = { type: 'sync-installation', githubInstallationId: parseGithubId(70_001), deliveryId: GUID };

/** Runs `work` with the transaction of a migrated database, which commits when `work` returns. */
async function inTransaction<T>(work: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
  const { db } = await migratedTestDatabase();
  return db.transaction().execute(work);
}

/** The job of the serialised queue (E07-S02): pull request 42 of repository 9001. */
const EVALUATION: Job = {
  type: 'evaluate-pr',
  githubInstallationId: parseGithubId(70_001),
  githubRepoId: parseGithubId(9001),
  prNumber: 42,
  trigger: 'pull_request',
  deliveryId: GUID,
};

/** The id pg-boss gives the row that is found: the adapter reads its state and does not look at the id. */
const JOB_ID_OF_THE_ROW = jobIdFor(GUID);
const KEY: EnqueueOptions = { idempotencyKey: GUID };
/** The connection of the transaction: its identity is not what the tests look at, that it is passed is. */
const SOME_CONNECTION: unknown = expect.anything();

test('a job is sent to the queue of its type, as itself, under the id of its idempotency key', async () => {
  const boss = fakeBoss();
  const outcome = await inTransaction((tx) => new PgBossEnqueuer(boss).enqueue(tx, JOB, KEY));
  expect(outcome).toBe('queued');
  expect(boss.send).toHaveBeenCalledExactlyOnceWith('sync-installation', JOB, {
    id: jobIdFor(GUID),
    db: SOME_CONNECTION,
  });
  expect(boss.findJobs).not.toHaveBeenCalled();
});

test('every job type of the catalogue has a queue of the same name', () => {
  const types = jobSchema.options.map((option) => option.shape.type.value);
  expect(types.toSorted((a, b) => a.localeCompare(b))).toEqual([
    'close-pr',
    'evaluate-head-sha',
    'evaluate-merge-group',
    'evaluate-pr',
    'recheck-comment',
    'revoke-user-sessions',
    'sync-installation',
  ]);
  for (const type of types) {
    expect(QUEUES).toContain(type);
  }
});

test('a dedupe key and window become the throttle of pg-boss: a singleton key and its window in seconds', async () => {
  const boss = fakeBoss();
  const options = { idempotencyKey: GUID, dedupeKey: 'sync:70001', dedupeWindowSeconds: 60 };
  await inTransaction((tx) => new PgBossEnqueuer(boss).enqueue(tx, JOB, options));
  expect(boss.send.mock.calls[0]?.[2]).toEqual({
    id: jobIdFor(GUID),
    db: SOME_CONNECTION,
    singletonKey: 'sync:70001',
    singletonSeconds: 60,
  });
});

test('an evaluate-pr job carries its serialisation key, the repository id and the pull request number, as pg-boss reads it', async () => {
  const boss = fakeBoss();
  await inTransaction((tx) => new PgBossEnqueuer(boss).enqueue(tx, EVALUATION, KEY));
  expect(boss.send).toHaveBeenCalledExactlyOnceWith('evaluate-pr', EVALUATION, {
    id: jobIdFor(GUID),
    db: SOME_CONNECTION,
    singletonKey: '9001:42',
  });
});

test('a dedupe window on an evaluate-pr job throttles per pull request: the serialisation key stays, the dedupe key is not stored', async () => {
  const boss = fakeBoss();
  const options = { idempotencyKey: GUID, dedupeKey: 'recheck:9001:42', dedupeWindowSeconds: 60 };
  await inTransaction((tx) => new PgBossEnqueuer(boss).enqueue(tx, EVALUATION, options));
  expect(boss.send.mock.calls[0]?.[2]).toEqual({
    id: jobIdFor(GUID),
    db: SOME_CONNECTION,
    singletonKey: '9001:42',
    singletonSeconds: 60,
  });
});

test('a coalesce key looks for a job of the key that has not started, and sends under it when there is none', async () => {
  const boss = fakeBoss();
  const options = { idempotencyKey: GUID, coalesceKey: 'sync:70001' };
  expect(await inTransaction((tx) => new PgBossEnqueuer(boss).enqueue(tx, JOB, options))).toBe('queued');
  expect(boss.findJobs.mock.calls).toEqual([
    ['sync-installation', { id: jobIdFor(GUID), db: SOME_CONNECTION }],
    ['sync-installation', { key: 'sync:70001', queued: true, limit: 1, db: SOME_CONNECTION }],
  ]);
  expect(boss.send).toHaveBeenCalledExactlyOnceWith('sync-installation', JOB, {
    id: jobIdFor(GUID),
    db: SOME_CONNECTION,
    singletonKey: 'sync:70001',
  });
});

test.each([['created'], ['retry']])(
  'a coalesce key and a job of the key in state %s that is another send: deduplicated, and nothing is sent',
  async (state) => {
    const boss = fakeBoss();
    boss.findJobs.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'another-job', state }]);
    const options = { idempotencyKey: GUID, coalesceKey: 'sync:70001' };
    expect(await inTransaction((tx) => new PgBossEnqueuer(boss).enqueue(tx, JOB, options))).toBe('deduplicated');
    expect(boss.send).not.toHaveBeenCalled();
  },
);

test.each([['created'], ['retry'], ['active']])(
  'a coalesce key and a live job under the id of the send in state %s: already_queued, before the key is looked at',
  async (state) => {
    const boss = fakeBoss();
    boss.findJobs.mockResolvedValueOnce([{ id: JOB_ID_OF_THE_ROW, state }]);
    const options = { idempotencyKey: GUID, coalesceKey: 'sync:70001' };
    expect(await inTransaction((tx) => new PgBossEnqueuer(boss).enqueue(tx, JOB, options))).toBe('already_queued');
    expect(boss.findJobs).toHaveBeenCalledOnce();
    expect(boss.send).not.toHaveBeenCalled();
  },
);

test('a coalesce key does not stop a send because of a job under the id that is over: the send goes on, and replaces it', async () => {
  const boss = fakeBoss();
  boss.findJobs
    .mockResolvedValueOnce([{ id: JOB_ID_OF_THE_ROW, state: 'completed' }])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ id: JOB_ID_OF_THE_ROW, state: 'completed' }]);
  boss.send.mockResolvedValueOnce(null).mockResolvedValueOnce('job-2');
  const options = { idempotencyKey: GUID, coalesceKey: 'sync:70001' };
  expect(await inTransaction((tx) => new PgBossEnqueuer(boss).enqueue(tx, JOB, options))).toBe('queued');
  expect(boss.deleteJob).toHaveBeenCalledExactlyOnceWith('sync-installation', jobIdFor(GUID), { db: SOME_CONNECTION });
});

test('a coalesce key on an evaluate-pr job is the serialisation key of its pull request, and it is sent without a window', async () => {
  const boss = fakeBoss();
  const options = { idempotencyKey: GUID, coalesceKey: 'evaluation:9001:42' };
  await inTransaction((tx) => new PgBossEnqueuer(boss).enqueue(tx, EVALUATION, options));
  expect(boss.findJobs.mock.calls[1]).toEqual([
    'evaluate-pr',
    { key: '9001:42', queued: true, limit: 1, db: SOME_CONNECTION },
  ]);
  expect(boss.send).toHaveBeenCalledExactlyOnceWith('evaluate-pr', EVALUATION, {
    id: jobIdFor(GUID),
    db: SOME_CONNECTION,
    singletonKey: '9001:42',
  });
});

test('a window that is not a whole number of seconds is refused for a serialised job too', async () => {
  const boss = fakeBoss();
  const options = { idempotencyKey: GUID, dedupeKey: 'recheck:9001:42', dedupeWindowSeconds: 0.5 };
  await expect(inTransaction((tx) => new PgBossEnqueuer(boss).enqueue(tx, EVALUATION, options))).rejects.toThrow(
    RangeError,
  );
  expect(boss.send).not.toHaveBeenCalled();
});

test.each([[0], [-5], [1.5], [Number.NaN], [Number.POSITIVE_INFINITY], [2 ** 53]])(
  'a dedupe window of %s seconds is refused before anything is sent',
  async (dedupeWindowSeconds) => {
    const boss = fakeBoss();
    const options = { idempotencyKey: GUID, dedupeKey: 'sync:70001', dedupeWindowSeconds };
    await expect(inTransaction((tx) => new PgBossEnqueuer(boss).enqueue(tx, JOB, options))).rejects.toThrow(
      'dedupeWindowSeconds must be a whole number of seconds, at least 1',
    );
    expect(boss.send).not.toHaveBeenCalled();
  },
);

test.each([['created'], ['retry'], ['active']])(
  'nothing inserted and a job under the key in state %s: already_queued, and that job is left alone',
  async (state) => {
    const boss = fakeBoss();
    boss.send.mockResolvedValueOnce(null);
    boss.findJobs.mockResolvedValueOnce([{ id: JOB_ID_OF_THE_ROW, state }]);
    const outcome = await inTransaction((tx) => new PgBossEnqueuer(boss).enqueue(tx, JOB, KEY));
    expect(outcome).toBe('already_queued');
    expect(boss.findJobs).toHaveBeenCalledExactlyOnceWith('sync-installation', {
      id: jobIdFor(GUID),
      db: SOME_CONNECTION,
    });
    expect(boss.deleteJob).not.toHaveBeenCalled();
    expect(boss.send).toHaveBeenCalledOnce();
  },
);

test('nothing inserted and no job under the key: a throttle window dropped the send', async () => {
  const boss = fakeBoss();
  boss.send.mockResolvedValueOnce(null);
  const options = { idempotencyKey: GUID, dedupeKey: 'sync:70001', dedupeWindowSeconds: 60 };
  expect(await inTransaction((tx) => new PgBossEnqueuer(boss).enqueue(tx, JOB, options))).toBe('deduplicated');
  expect(boss.deleteJob).not.toHaveBeenCalled();
});

test.each([['completed'], ['failed'], ['cancelled']])(
  'a job under the key that is over (%s) is removed and the job is sent again: a redelivery is not lost',
  async (state) => {
    const boss = fakeBoss();
    boss.send.mockResolvedValueOnce(null).mockResolvedValueOnce('new-job');
    boss.findJobs.mockResolvedValueOnce([{ id: JOB_ID_OF_THE_ROW, state }]);
    const outcome = await inTransaction((tx) => new PgBossEnqueuer(boss).enqueue(tx, JOB, KEY));
    expect(outcome).toBe('queued');
    expect(boss.deleteJob).toHaveBeenCalledExactlyOnceWith('sync-installation', jobIdFor(GUID), {
      db: SOME_CONNECTION,
    });
    expect(boss.send).toHaveBeenCalledTimes(2);
    expect(boss.send.mock.calls[1]).toEqual(boss.send.mock.calls[0]);
  },
);

test('a finished job removed and the new send dropped by a window: deduplicated', async () => {
  const boss = fakeBoss();
  boss.send.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
  boss.findJobs.mockResolvedValueOnce([{ id: JOB_ID_OF_THE_ROW, state: 'failed' }]);
  expect(await inTransaction((tx) => new PgBossEnqueuer(boss).enqueue(tx, JOB, KEY))).toBe('deduplicated');
  expect(boss.deleteJob).toHaveBeenCalledOnce();
});

test('the database handed to pg-boss runs on the connection of the transaction: a rollback takes its statements with it', async () => {
  const { db } = await migratedTestDatabase();
  const boss = fakeBoss();
  boss.send.mockImplementation(async (_name, _data, options) => {
    await options.db?.executeSql("insert into webhook_deliveries (delivery_id, event) values ($1, 'pull_request')", [
      GUID,
    ]);
    return 'job-id';
  });
  const rollback = new Error('rolled back on purpose');
  await expect(
    db.transaction().execute(async (tx) => {
      await new PgBossEnqueuer(boss).enqueue(tx, JOB, KEY);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
  expect(await db.selectFrom('webhook_deliveries').select('delivery_id').execute()).toEqual([]);
  await db.transaction().execute((tx) => new PgBossEnqueuer(boss).enqueue(tx, JOB, KEY));
  expect(await db.selectFrom('webhook_deliveries').select('delivery_id').execute()).toEqual([{ delivery_id: GUID }]);
});

test('a failing send is thrown to the caller, which rolls back', async () => {
  const boss = fakeBoss();
  const failure = new Error('connection lost');
  boss.send.mockRejectedValueOnce(failure);
  await expect(inTransaction((tx) => new PgBossEnqueuer(boss).enqueue(tx, JOB, KEY))).rejects.toBe(failure);
});

test('a sweep-installation job of the scheduled sweep goes to its own queue, throttled by its dedupe key and not serialised (E07-S08)', async () => {
  const boss = fakeBoss();
  const sweepJob = { type: 'sweep-installation', githubInstallationId: parseGithubId(70_001) } as const;
  const options = {
    idempotencyKey: 'sweep:job-1:70001',
    dedupeKey: 'sweep-installation:70001',
    dedupeWindowSeconds: 60,
  };
  expect(await inTransaction((tx) => new PgBossEnqueuer(boss).enqueue(tx, sweepJob, options))).toBe('queued');
  expect(boss.send).toHaveBeenCalledExactlyOnceWith('sweep-installation', sweepJob, {
    id: jobIdFor('sweep:job-1:70001'),
    db: SOME_CONNECTION,
    singletonKey: 'sweep-installation:70001',
    singletonSeconds: 60,
  });
  expect(QUEUES).toContain('sweep-installation');
});
