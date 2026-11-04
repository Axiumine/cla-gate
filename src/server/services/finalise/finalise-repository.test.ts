// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import type { JobEnqueuer } from '../ports/jobs.ts';
import { finaliseRepository } from './finalise-repository.ts';
import { FINALISE_BATCH } from './finalise-rows.ts';
import {
  type FinaliseWorld,
  finaliseWorld,
  INSTALLATION,
  NOT_FINALISED,
  PR_NUMBER,
  REPOSITORY,
  REPOSITORY_JOB,
  seedEvaluation,
  seedMany,
} from './test-support.ts';

// The `finalise-repository` job (E14-S04): it reads the stored rows of one repository and sends one `finalise-check` job per pull
// request whose latest evaluation is `in_progress` or `failure`, 50 pull requests to a transaction, and does nothing else.

const prNumbersSent = async (world: FinaliseWorld): Promise<number[]> =>
  (await world.sent()).map((sent) => (sent.job.type === 'finalise-check' ? sent.job.prNumber : -1));

test('one finalise-check job per pull request is sent, under the key of the run', async () => {
  const world = await finaliseWorld();
  await seedEvaluation(world, { result: 'failure', prNumber: 3 });
  expect(await world.runRepository(undefined, 'job-9')).toEqual({ outcome: 'queued' });
  expect(await world.sent()).toEqual([
    {
      idempotencyKey: `finalise-check:job-9:${String(REPOSITORY)}:3`,
      dedupeKey: null,
      job: { type: 'finalise-check', githubInstallationId: INSTALLATION, githubRepoId: REPOSITORY, prNumber: 3 },
    },
  ]);
  expect(world.logs.lines()).toContainEqual(
    expect.objectContaining({ msg: 'finalise_repository.queued', pullRequests: 1 }),
  );
});

/** Stores an evaluation of pull request `prNumber` whose head SHA is made of `head`, last changed at `updatedAt`. */
async function seedAt(
  world: FinaliseWorld,
  row: {
    prNumber: number;
    head: string;
    result: 'in_progress' | 'success' | 'failure' | 'cancelled';
    updatedAt: string;
  },
): Promise<void> {
  const id = await seedEvaluation(world, { result: row.result, prNumber: row.prNumber, headSha: row.head.repeat(40) });
  await sql`update pr_evaluations set updated_at = ${row.updatedAt}::timestamptz where id = ${id}`.execute(world.raw);
}

test('only the latest evaluation of a pull request counts: in_progress and failure are finalised, success and cancelled are not touched', async () => {
  const world = await finaliseWorld();
  await seedEvaluation(world, { result: 'failure', prNumber: 1, headSha: '1'.repeat(40) });
  await seedEvaluation(world, { result: 'success', prNumber: 1, headSha: '2'.repeat(40) });
  await seedEvaluation(world, { result: 'success', prNumber: 2, headSha: '1'.repeat(40) });
  await seedEvaluation(world, { result: 'failure', prNumber: 2, headSha: '2'.repeat(40) });
  await seedEvaluation(world, { result: 'in_progress', prNumber: 3 });
  await seedEvaluation(world, { result: 'success', prNumber: 4 });
  await seedEvaluation(world, { result: 'cancelled', prNumber: 5 });
  await seedEvaluation(world, { result: 'failure', prNumber: 6 });
  await world.runRepository();
  expect(await prNumbersSent(world)).toEqual([2, 3, 6]);
});

test('the latest row is the one that changed last, and rows that changed together are told apart by their id', async () => {
  const world = await finaliseWorld();
  const then = '2026-01-01T00:00:00Z';
  const later = '2026-01-01T01:00:00Z';
  await seedAt(world, { prNumber: 1, head: 'a', result: 'failure', updatedAt: later });
  await seedAt(world, { prNumber: 1, head: 'b', result: 'success', updatedAt: then });
  await seedAt(world, { prNumber: 2, head: 'a', result: 'in_progress', updatedAt: then });
  await seedAt(world, { prNumber: 2, head: 'b', result: 'success', updatedAt: then });
  await seedAt(world, { prNumber: 3, head: 'a', result: 'success', updatedAt: then });
  await seedAt(world, { prNumber: 3, head: 'b', result: 'failure', updatedAt: then });
  await world.runRepository();
  expect(await prNumbersSent(world)).toEqual([1, 3]);
});

test('a repository with nothing to finalise is queued all the same, with no send', async () => {
  const world = await finaliseWorld();
  await seedEvaluation(world, { result: 'success' });
  expect(await world.runRepository()).toEqual({ outcome: 'queued' });
  expect(await world.sent()).toEqual([]);
  expect(world.logs.lines()).toContainEqual(
    expect.objectContaining({ msg: 'finalise_repository.queued', pullRequests: 0 }),
  );
});

test('a page of the walk holds 50 pull requests, as the story says', () => {
  expect(FINALISE_BATCH).toBe(50);
});

test('more than one batch is walked: every pull request is sent once, ascending, 50 to a transaction and the rest in the last', async () => {
  const world = await finaliseWorld();
  await seedMany(world, 120, 'in_progress');
  const sendsPerTransaction = new Map<object, number>();
  const counting: JobEnqueuer = {
    enqueue: (tx, job, options) => {
      sendsPerTransaction.set(tx, (sendsPerTransaction.get(tx) ?? 0) + 1);
      return world.enqueuer.enqueue(tx, job, options);
    },
  };
  await finaliseRepository(world.ports, REPOSITORY_JOB, { logger: world.logger, enqueuer: counting, jobId: 'job-9' });
  expect([...sendsPerTransaction.values()]).toEqual([50, 50, 20]);
  expect(await prNumbersSent(world)).toEqual(Array.from({ length: 120 }, (_unused, index) => index + 1));
});

test('the batches are transactions of their own: a send that fails rolls back its batch only, and the retry sends the rest under the same keys', async () => {
  const world = await finaliseWorld();
  const count = FINALISE_BATCH + 10;
  await seedMany(world, count, 'failure');
  let sends = 0;
  const failing: JobEnqueuer = {
    enqueue: (tx, job, options) => {
      sends += 1;
      return sends === FINALISE_BATCH + 5
        ? Promise.reject(new Error('the queue is down'))
        : world.enqueuer.enqueue(tx, job, options);
    },
  };
  const context = { logger: world.logger, enqueuer: failing, jobId: 'job-3' };
  await expect(finaliseRepository(world.ports, REPOSITORY_JOB, context)).rejects.toThrow('the queue is down');
  expect(await prNumbersSent(world)).toHaveLength(FINALISE_BATCH);
  expect(await finaliseRepository(world.ports, REPOSITORY_JOB, context)).toEqual({ outcome: 'queued' });
  expect(await prNumbersSent(world)).toEqual(Array.from({ length: count }, (_unused, index) => index + 1));
});

test('a retry of the job finds its own sends: nothing is sent twice, and another run sends again', async () => {
  const world = await finaliseWorld();
  await seedEvaluation(world, { result: 'failure' });
  await world.runRepository(undefined, 'job-1');
  await world.runRepository(undefined, 'job-1');
  expect(await prNumbersSent(world)).toEqual([PR_NUMBER]);
  await sql`update fake_jobs set state = 'completed'`.execute(world.raw);
  await world.runRepository(undefined, 'job-2');
  expect(await prNumbersSent(world)).toEqual([PR_NUMBER, PR_NUMBER]);
});

test.each(NOT_FINALISED)(
  'a tenant that is %s ends the job as skipped, logs the reason and sends nothing, with no GitHub call',
  async (reason, statement) => {
    const world = await finaliseWorld();
    await seedEvaluation(world, { result: 'failure' });
    await sql.raw(statement).execute(world.raw);
    expect(await world.runRepository()).toEqual({ outcome: `skipped:${reason}` });
    expect(await world.sent()).toEqual([]);
    expect(world.calls()).toEqual([]);
    expect(world.logs.lines()).toContainEqual(expect.objectContaining({ msg: 'finalise_repository.skipped', reason }));
  },
);

test('an installation nobody stored, and a repository the installation never had, end the job as skipped', async () => {
  const world = await finaliseWorld();
  await seedEvaluation(world, { result: 'failure' });
  expect(await world.runRepository({ ...REPOSITORY_JOB, githubInstallationId: parseGithubId(999_999) })).toEqual({
    outcome: 'skipped:installation_not_found',
  });
  expect(await world.runRepository({ ...REPOSITORY_JOB, githubRepoId: parseGithubId(123_456) })).toEqual({
    outcome: 'skipped:repository_not_found',
  });
  expect(await world.sent()).toEqual([]);
});

test('the job writes nothing but its sends: the rows of pr_evaluations and the repository stay as they are', async () => {
  const world = await finaliseWorld();
  await seedEvaluation(world, { result: 'failure' });
  const before = [await world.rows(), await world.raw.selectFrom('repositories').selectAll().execute()];
  await world.runRepository();
  expect([await world.rows(), await world.raw.selectFrom('repositories').selectAll().execute()]).toEqual(before);
});
