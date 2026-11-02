// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import { expect } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import type { Database } from '../../adapters/db/schema.ts';
import type { Job } from '../../domain/jobs.ts';
import type { JobEnqueuer } from '../ports/jobs.ts';

// The contract of the job enqueuer port (E06-S06): what every implementation does, written once. It runs against the
// fake the webhook intake is tested with (services/jobs-contract/fake.test.ts) and, on a real Postgres, against the
// pg-boss adapter (E07-S01), so the fake the other tests rely on cannot drift from the queue.

/** A queue, scripted by a test and read through the enqueuer under test. */
export interface JobsWorld {
  readonly enqueuer: JobEnqueuer;
  /** A database to open transactions on: the enqueuer sends on the connection of the transaction it is given. */
  readonly db: Kysely<Database>;
  /** How many live jobs the queue holds now, committed ones only. */
  readonly liveJobs: () => Promise<number>;
}

const SYNC: Job = { type: 'sync-installation', githubInstallationId: parseGithubId(70_001) };
const OTHER: Job = { type: 'sync-installation', githubInstallationId: parseGithubId(70_002) };

/** Sends `job` in a transaction of its own that commits. */
function committed(world: JobsWorld, job: Job, options: Parameters<JobEnqueuer['enqueue']>[2]) {
  return world.db.transaction().execute((tx) => world.enqueuer.enqueue(tx, job, options));
}

async function commitsExactlyOne(world: JobsWorld): Promise<void> {
  expect(await committed(world, SYNC, { idempotencyKey: 'key-1' })).toBe('queued');
  expect(await world.liveJobs()).toBe(1);
}

async function rollbackLeavesNothing(world: JobsWorld): Promise<void> {
  const rollback = new Error('rolled back on purpose');
  await expect(
    world.db.transaction().execute(async (tx) => {
      expect(await world.enqueuer.enqueue(tx, SYNC, { idempotencyKey: 'key-1' })).toBe('queued');
      throw rollback;
    }),
  ).rejects.toBe(rollback);
  expect(await world.liveJobs()).toBe(0);
}

async function repeatedKeyLeavesOne(world: JobsWorld): Promise<void> {
  expect(await committed(world, SYNC, { idempotencyKey: 'key-1' })).toBe('queued');
  expect(await committed(world, SYNC, { idempotencyKey: 'key-1' })).toBe('deduplicated');
  expect(await world.liveJobs()).toBe(1);
}

async function repeatedKeyInOneTransactionLeavesOne(world: JobsWorld): Promise<void> {
  const outcomes = await world.db
    .transaction()
    .execute(async (tx) => [
      await world.enqueuer.enqueue(tx, SYNC, { idempotencyKey: 'key-1' }),
      await world.enqueuer.enqueue(tx, SYNC, { idempotencyKey: 'key-1' }),
    ]);
  expect(outcomes).toEqual(['queued', 'deduplicated']);
  expect(await world.liveJobs()).toBe(1);
}

async function otherKeysAreOtherJobs(world: JobsWorld): Promise<void> {
  expect(await committed(world, SYNC, { idempotencyKey: 'key-1' })).toBe('queued');
  expect(await committed(world, OTHER, { idempotencyKey: 'key-2' })).toBe('queued');
  expect(await world.liveJobs()).toBe(2);
}

async function dedupeWindowDropsTheSecond(world: JobsWorld): Promise<void> {
  const window = { dedupeKey: 'sync:70001', dedupeWindowSeconds: 60 };
  expect(await committed(world, SYNC, { idempotencyKey: 'key-1', ...window })).toBe('queued');
  expect(await committed(world, SYNC, { idempotencyKey: 'key-2', ...window })).toBe('deduplicated');
  expect(await world.liveJobs()).toBe(1);
}

async function dedupeKeysAreIndependent(world: JobsWorld): Promise<void> {
  const send = (key: string, dedupeKey: string) =>
    committed(world, SYNC, { idempotencyKey: key, dedupeKey, dedupeWindowSeconds: 60 });
  expect(await send('key-1', 'sync:70001')).toBe('queued');
  expect(await send('key-2', 'sync:70002')).toBe('queued');
  expect(await world.liveJobs()).toBe(2);
}

async function rolledBackSendDoesNotStartAWindow(world: JobsWorld): Promise<void> {
  const window = { dedupeKey: 'sync:70001', dedupeWindowSeconds: 60 };
  await world.db
    .transaction()
    .execute(async (tx) => {
      await world.enqueuer.enqueue(tx, SYNC, { idempotencyKey: 'key-1', ...window });
      throw new Error('rolled back on purpose');
    })
    .catch(() => undefined);
  expect(await committed(world, SYNC, { idempotencyKey: 'key-2', ...window })).toBe('queued');
  expect(await world.liveJobs()).toBe(1);
}

/** Each case is `[name, run]`, to be given a fresh world: the world holds no job when it starts. */
export const CONTRACT_CASES: readonly (readonly [string, (world: JobsWorld) => Promise<void>])[] = [
  ['a committed send leaves exactly one job', commitsExactlyOne],
  ['a rolled-back send leaves no job', rollbackLeavesNothing],
  ['a repeated idempotency key leaves one job and answers deduplicated', repeatedKeyLeavesOne],
  ['a repeated idempotency key inside one transaction leaves one job', repeatedKeyInOneTransactionLeavesOne],
  ['other idempotency keys are other jobs', otherKeysAreOtherJobs],
  ['a send inside a dedupe window is deduplicated', dedupeWindowDropsTheSecond],
  ['other dedupe keys are other windows', dedupeKeysAreIndependent],
  ['a rolled-back send starts no dedupe window', rolledBackSendDoesNotStartAWindow],
];
