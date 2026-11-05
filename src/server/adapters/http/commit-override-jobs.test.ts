// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { sweepRepositoryCoalesceKey } from '../../domain/repository-jobs.ts';
import { commit, commitSha } from '../../services/github-pull-contract/test-support.ts';
import {
  failingAfterSend,
  fakeEnqueuer,
  jobCount,
  sentJobs,
  switchableEnqueuer,
} from '../../services/jobs-fixture/test-support.ts';
import {
  COMMIT,
  evaluatedPullRequests,
  jobsOf,
  overrideOf,
  overrideWorld,
  plainOf,
  recordAs,
  scopedOf,
  storedOverrides,
  storeEvaluation,
} from './commit-override-fixture/test-support.ts';
import { auditRows, documentWorld, errorCodeOf, tablesOf } from './document-fixture/test-support.ts';
import { pointAt, setEnabled } from './repository-document-fixture/test-support.ts';

// The pull requests that recording an override evaluates again (E15-S05), through the queue of the app: one `evaluate-pr` job for each
// open pull request of the repository whose latest evaluation is a failure or is in flight (the run may have read the overrides before
// this one committed), or above 100 of them one `sweep-repository` job with the
// reason `override_changed`, in the transaction of the record, so a queue that fails leaves the override, the audit log and the queue as
// they were and a retry then succeeds. The queue is the fake of the webhook intake.

type World = Awaited<ReturnType<typeof overrideWorld>>;

const numbersOf = async (world: World) =>
  (await jobsOf(world, 'evaluate-pr')).flatMap((sent) => (sent.job.type === 'evaluate-pr' ? [sent.job.prNumber] : []));

test('each open pull request of the repository whose latest evaluation failed or is in flight gets an evaluate-pr job, and no other pull request does', async () => {
  const world = await overrideWorld();
  const { t1, t2 } = world;
  await evaluatedPullRequests(world, plainOf(t1), { numbers: [101, 102, 103], result: 'failure' });
  await evaluatedPullRequests(world, plainOf(t1), { numbers: [104], result: 'success' });
  await evaluatedPullRequests(world, plainOf(t1), { numbers: [105], result: 'in_progress' });
  await evaluatedPullRequests(world, plainOf(t1), { numbers: [106], result: 'failure', state: 'closed' });
  await evaluatedPullRequests(world, scopedOf(t1), { numbers: [107], result: 'failure' });
  await evaluatedPullRequests(world, plainOf(t2), { numbers: [108], result: 'failure' });
  const response = await recordAs(world, 'admin1', t1.plain.repositoryId, COMMIT);
  expect(response.statusCode).toBe(201);
  const { id } = overrideOf(response);
  expect(await sentJobs(world.db)).toEqual(
    [101, 102, 103, 105].map((prNumber) => ({
      idempotencyKey: `override_changed:created:${id}:${t1.plain.githubRepoId}:${prNumber}`,
      dedupeKey: null,
      job: {
        type: 'evaluate-pr',
        githubInstallationId: t1.githubInstallationId,
        githubRepoId: t1.plain.githubRepoId,
        prNumber,
        trigger: 'policy_change',
      },
    })),
  );
});

test('only the latest evaluation of a pull request counts: one that failed and then passed is not evaluated again, one that passed and then failed is', async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  const target = plainOf(t1);
  await storeEvaluation(world, target, {
    prNumber: 101,
    head: 1,
    result: 'failure',
    updatedAt: '2026-11-01T10:00:00Z',
  });
  await storeEvaluation(world, target, {
    prNumber: 101,
    head: 2,
    result: 'success',
    updatedAt: '2026-11-02T10:00:00Z',
  });
  await storeEvaluation(world, target, {
    prNumber: 102,
    head: 3,
    result: 'success',
    updatedAt: '2026-11-01T10:00:00Z',
  });
  await storeEvaluation(world, target, {
    prNumber: 102,
    head: 4,
    result: 'failure',
    updatedAt: '2026-11-02T10:00:00Z',
  });
  expect((await recordAs(world, 'admin1', t1.plain.repositoryId, COMMIT)).statusCode).toBe(201);
  expect(await numbersOf(world)).toEqual([102]);
});

test('exactly 100 failing pull requests are evaluated one by one', async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  await evaluatedPullRequests(world, plainOf(t1), {
    numbers: Array.from({ length: 100 }, (_unused, index) => 101 + index),
    result: 'failure',
  });
  expect((await recordAs(world, 'admin1', t1.plain.repositoryId, COMMIT)).statusCode).toBe(201);
  expect(await numbersOf(world)).toHaveLength(100);
  expect(await jobsOf(world, 'sweep-repository')).toEqual([]);
});

test('101 failing pull requests are swept instead: one sweep-repository job with the reason override_changed, and no evaluate-pr job', async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  await evaluatedPullRequests(world, plainOf(t1), {
    numbers: Array.from({ length: 101 }, (_unused, index) => 101 + index),
    result: 'failure',
  });
  const response = await recordAs(world, 'admin1', t1.plain.repositoryId, COMMIT);
  expect(response.statusCode).toBe(201);
  expect(await sentJobs(world.db)).toEqual([
    {
      idempotencyKey: `sweep-repository:override_changed:created:${overrideOf(response).id}:${t1.plain.githubRepoId}`,
      dedupeKey: null,
      coalesceKey: sweepRepositoryCoalesceKey(t1.plain.githubRepoId),
      job: {
        type: 'sweep-repository',
        githubInstallationId: t1.githubInstallationId,
        githubRepoId: t1.plain.githubRepoId,
        reason: 'override_changed',
      },
    },
  ]);
});

test('failing pull requests of another repository of the tenant, and of the other tenant, do not count towards the 100', async () => {
  const world = await overrideWorld();
  const { t1, t2 } = world;
  const many = (first: number) => Array.from({ length: 60 }, (_unused, index) => first + index);
  await evaluatedPullRequests(world, plainOf(t1), { numbers: many(101), result: 'failure' });
  await evaluatedPullRequests(world, scopedOf(t1), { numbers: many(101), result: 'failure' });
  await evaluatedPullRequests(world, plainOf(t2), { numbers: many(101), result: 'failure' });
  expect((await recordAs(world, 'admin1', t1.plain.repositoryId, COMMIT)).statusCode).toBe(201);
  expect(await numbersOf(world)).toHaveLength(60);
  expect(await jobsOf(world, 'sweep-repository')).toEqual([]);
});

test('a repository with no failing pull request sends no job, and the record still succeeds', async () => {
  const world = await overrideWorld();
  const response = await recordAs(world, 'admin1', world.t1.plain.repositoryId, COMMIT);
  expect([response.statusCode, await jobCount(world.db)]).toEqual([201, 0]);
});

test('a second override while the first job waits sends a job of its own for the same pull request: the keys name the override', async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  world.fakeGitHub.setRepositoryCommits(t1.githubInstallationId, t1.plain.fullName, [commit(1), commit(2)]);
  await evaluatedPullRequests(world, plainOf(t1), { numbers: [101], result: 'failure' });
  const first = await recordAs(world, 'admin1', t1.plain.repositoryId, commitSha(1));
  const second = await recordAs(world, 'admin1', t1.plain.repositoryId, commitSha(2));
  expect([first.statusCode, second.statusCode]).toEqual([201, 201]);
  expect((await sentJobs(world.db)).map((sent) => sent.idempotencyKey)).toEqual([
    `override_changed:created:${overrideOf(first).id}:${t1.plain.githubRepoId}:101`,
    `override_changed:created:${overrideOf(second).id}:${t1.plain.githubRepoId}:101`,
  ]);
});

test('a queue that fails fails the call: 500, every tenant table as it was, no override, no audit row, and the message does not leak', async () => {
  const world = await overrideWorld({ enqueuer: { enqueue: () => Promise.reject(new Error('queue down')) } });
  await evaluatedPullRequests(world, plainOf(world.t1), { numbers: [101], result: 'failure' });
  const before = await tablesOf(world);
  const response = await recordAs(world, 'admin1', world.t1.plain.repositoryId, COMMIT);
  expect(response.statusCode).toBe(500);
  expect(errorCodeOf(response)).toBe('internal_server_error');
  expect(response.body).not.toContain('queue down');
  expect(await tablesOf(world)).toEqual(before);
  expect(await storedOverrides(world)).toEqual([]);
  expect(await auditRows(world, 'commit_override.created')).toEqual([]);
});

test('a retry after the queue came back succeeds: one override, one audit row and the job', async () => {
  const queue = switchableEnqueuer(fakeEnqueuer());
  const world = await overrideWorld({ enqueuer: queue });
  await evaluatedPullRequests(world, plainOf(world.t1), { numbers: [101], result: 'failure' });
  queue.failWith(new Error('connection lost'));
  const failed = await recordAs(world, 'admin1', world.t1.plain.repositoryId, COMMIT);
  queue.failWith(undefined);
  const retried = await recordAs(world, 'admin1', world.t1.plain.repositoryId, COMMIT);
  expect([failed.statusCode, retried.statusCode]).toEqual([500, 201]);
  expect(await storedOverrides(world)).toHaveLength(1);
  expect(await auditRows(world, 'commit_override.created')).toHaveLength(1);
  expect(await numbersOf(world)).toEqual([101]);
});

test('a queue that fails after it took the job leaves no job behind, because the job commits with the override or not at all', async () => {
  const world = await overrideWorld({ enqueuer: failingAfterSend(fakeEnqueuer(), new Error('connection lost')) });
  await evaluatedPullRequests(world, plainOf(world.t1), { numbers: [101], result: 'failure' });
  const response = await recordAs(world, 'admin1', world.t1.plain.repositoryId, COMMIT);
  expect(response.statusCode).toBe(500);
  expect(await jobCount(world.db)).toBe(0);
  expect(await storedOverrides(world)).toEqual([]);
});

test('the app that has no queue yet fails a record that has a job to send, and stores nothing; one with nothing to send succeeds', async () => {
  const world = await documentWorld();
  const { t1 } = world;
  await pointAt(world, t1.plain.repositoryId, t1.documentId);
  await setEnabled(world, t1.plain.repositoryId, true);
  await evaluatedPullRequests(world, plainOf(t1), { numbers: [101], result: 'failure' });
  const failed = await recordAs(world, 'admin1', t1.plain.repositoryId, COMMIT);
  expect(failed.statusCode).toBe(500);
  expect(await world.db.selectFrom('commit_overrides').select('id').where('commit_sha', '=', COMMIT).execute()).toEqual(
    [],
  );
  await world.db.deleteFrom('pr_evaluations').where('pr_number', '=', 101).execute();
  expect((await recordAs(world, 'admin1', t1.plain.repositoryId, COMMIT)).statusCode).toBe(201);
});
