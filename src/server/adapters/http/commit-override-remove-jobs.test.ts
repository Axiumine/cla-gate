// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { sweepRepositoryCoalesceKey } from '../../domain/repository-jobs.ts';
import {
  failingAfterSend,
  fakeEnqueuer,
  jobCount,
  sentJobs,
  switchableEnqueuer,
} from '../../services/jobs-fixture/test-support.ts';
import {
  jobsOf,
  overriddenPullRequest,
  overrideIdOf,
  overridesIn,
  overrideWorld,
  plainOf,
  removeOverrideAs,
  restingOnOverride,
  SEEDED_COMMIT,
  scopedOf,
  shaOf,
  waivedBy,
} from './commit-override-fixture/test-support.ts';
import { auditRows, documentWorld, errorCodeOf, tablesOf } from './document-fixture/test-support.ts';
import { pointAt, setEnabled } from './repository-document-fixture/test-support.ts';

// The pull requests that removing an override evaluates again (E15-S06), through the queue of the app: one `evaluate-pr` job for each
// open pull request of the repository whose latest result is a success and whose stored details list the commit with an override, or above
// 100 of them one `sweep-repository` job with the reason `override_changed`, in the transaction of the removal, so a queue that fails
// leaves the override, the audit log and the queue as they were. The queue is the fake of the webhook intake.

type World = Awaited<ReturnType<typeof overrideWorld>>;

const numbersOf = async (world: World) =>
  (await jobsOf(world, 'evaluate-pr')).flatMap((sent) => (sent.job.type === 'evaluate-pr' ? [sent.job.prNumber] : []));

/** The override of tenant 1's plain repository that the world stores, which the pull requests of these tests rest on. */
const seeded = (world: World) => overrideIdOf(world, world.t1.plain.repositoryId, SEEDED_COMMIT);

test('each open pull request whose latest result is a success that rests on the override gets an evaluate-pr job, and no other pull request does', async () => {
  const world = await overrideWorld();
  const { t1, t2 } = world;
  const id = await seeded(world);
  const other = await overrideIdOf(world, t2.plain.repositoryId, SEEDED_COMMIT);
  const target = plainOf(t1);
  await overriddenPullRequest(world, target, { prNumber: 101, unlinked: waivedBy(id) });
  await overriddenPullRequest(world, target, {
    prNumber: 102,
    unlinked: [...waivedBy(id, shaOf(9)), ...waivedBy(id)],
  });
  await overriddenPullRequest(world, target, {
    prNumber: 103,
    unlinked: [{ sha: SEEDED_COMMIT, role: 'author', overrideId: null }],
  });
  await overriddenPullRequest(world, target, { prNumber: 104, unlinked: waivedBy(id, shaOf(9)) });
  await overriddenPullRequest(world, target, { prNumber: 105, unlinked: waivedBy(id), result: 'failure' });
  await overriddenPullRequest(world, target, { prNumber: 106, unlinked: waivedBy(id), state: 'closed' });
  await overriddenPullRequest(world, target, { prNumber: 107, unlinked: [] });
  await overriddenPullRequest(world, scopedOf(t1), { prNumber: 108, unlinked: waivedBy(id) });
  await overriddenPullRequest(world, plainOf(t2), { prNumber: 109, unlinked: waivedBy(other) });
  expect((await removeOverrideAs(world, 'admin1', t1.plain.repositoryId, id)).statusCode).toBe(204);
  expect(await sentJobs(world.db)).toEqual(
    [101, 102].map((prNumber) => ({
      idempotencyKey: `override_changed:deleted:${id}:${t1.plain.githubRepoId}:${prNumber}`,
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

test('a pull request that rests on another override of the repository is not evaluated again: the removal takes away the waiver of its own commit only', async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  const id = await seeded(world);
  await world.db
    .insertInto('commit_overrides')
    .values({
      installation_id: t1.installationId,
      repository_id: t1.plain.repositoryId,
      commit_sha: shaOf(9),
      created_by: world.people.admin1.userId,
      reason: 'another commit',
    })
    .execute();
  const another = await overrideIdOf(world, t1.plain.repositoryId, shaOf(9));
  await overriddenPullRequest(world, plainOf(t1), { prNumber: 101, unlinked: waivedBy(another, shaOf(9)) });
  await overriddenPullRequest(world, plainOf(t1), { prNumber: 102, unlinked: waivedBy(id) });
  expect((await removeOverrideAs(world, 'admin1', t1.plain.repositoryId, id)).statusCode).toBe(204);
  expect(await numbersOf(world)).toEqual([102]);
  expect(await overridesIn(world, t1.plain.repositoryId)).toEqual([[another, shaOf(9)]]);
});

test('only the latest evaluation of a pull request counts: one that passed on the override and then failed is not evaluated again, one that failed and then passed on it is', async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  const id = await seeded(world);
  const target = plainOf(t1);
  await overriddenPullRequest(world, target, {
    prNumber: 101,
    head: 1,
    unlinked: waivedBy(id),
    updatedAt: '2026-11-01T10:00:00Z',
  });
  await overriddenPullRequest(world, target, {
    prNumber: 101,
    head: 2,
    unlinked: [],
    result: 'failure',
    updatedAt: '2026-11-02T10:00:00Z',
  });
  await overriddenPullRequest(world, target, {
    prNumber: 102,
    head: 3,
    unlinked: [],
    result: 'failure',
    updatedAt: '2026-11-01T10:00:00Z',
  });
  await overriddenPullRequest(world, target, {
    prNumber: 102,
    head: 4,
    unlinked: waivedBy(id),
    updatedAt: '2026-11-02T10:00:00Z',
  });
  expect((await removeOverrideAs(world, 'admin1', t1.plain.repositoryId, id)).statusCode).toBe(204);
  expect(await numbersOf(world)).toEqual([102]);
});

test('exactly 100 pull requests that rest on the override are evaluated one by one', async () => {
  const world = await overrideWorld();
  const id = await seeded(world);
  for (let prNumber = 101; prNumber <= 200; prNumber += 1) {
    await overriddenPullRequest(world, plainOf(world.t1), { prNumber, unlinked: waivedBy(id) });
  }
  expect((await removeOverrideAs(world, 'admin1', world.t1.plain.repositoryId, id)).statusCode).toBe(204);
  expect(await numbersOf(world)).toHaveLength(100);
  expect(await jobsOf(world, 'sweep-repository')).toEqual([]);
});

test('101 pull requests that rest on the override are swept instead: one sweep-repository job with the reason override_changed, and no evaluate-pr job', async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  const id = await seeded(world);
  for (let prNumber = 101; prNumber <= 201; prNumber += 1) {
    await overriddenPullRequest(world, plainOf(t1), { prNumber, unlinked: waivedBy(id) });
  }
  expect((await removeOverrideAs(world, 'admin1', t1.plain.repositoryId, id)).statusCode).toBe(204);
  expect(await sentJobs(world.db)).toEqual([
    {
      idempotencyKey: `sweep-repository:override_changed:deleted:${id}:${t1.plain.githubRepoId}`,
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

test('pull requests of another repository of the tenant, and of the other tenant, do not count towards the 100', async () => {
  const world = await overrideWorld();
  const { t1, t2 } = world;
  const id = await seeded(world);
  const otherTenant = await overrideIdOf(world, t2.plain.repositoryId, SEEDED_COMMIT);
  for (let prNumber = 101; prNumber <= 160; prNumber += 1) {
    await overriddenPullRequest(world, plainOf(t1), { prNumber, unlinked: waivedBy(id) });
    await overriddenPullRequest(world, scopedOf(t1), { prNumber, unlinked: waivedBy(id) });
    await overriddenPullRequest(world, plainOf(t2), { prNumber, unlinked: waivedBy(otherTenant) });
  }
  expect((await removeOverrideAs(world, 'admin1', t1.plain.repositoryId, id)).statusCode).toBe(204);
  expect(await numbersOf(world)).toHaveLength(60);
  expect(await jobsOf(world, 'sweep-repository')).toEqual([]);
});

test('a removal with no pull request that rests on the override sends no job, and still succeeds and audits', async () => {
  const world = await overrideWorld();
  const id = await seeded(world);
  const response = await removeOverrideAs(world, 'admin1', world.t1.plain.repositoryId, id);
  expect([
    response.statusCode,
    await jobCount(world.db),
    (await auditRows(world, 'commit_override.deleted')).length,
  ]).toEqual([204, 0, 1]);
});

test('a repository that is switched off is cleaned all the same, and its pull requests are evaluated again so that a result that rested on the override does not outlive it', async () => {
  const world = await overrideWorld();
  const id = await restingOnOverride(world);
  await setEnabled(world, world.t1.plain.repositoryId, false);
  expect((await removeOverrideAs(world, 'admin1', world.t1.plain.repositoryId, id)).statusCode).toBe(204);
  expect(await numbersOf(world)).toEqual([101]);
});

test('a queue that fails fails the call: 500, every tenant table as it was, the override stays, no audit row, and the message does not leak', async () => {
  const world = await overrideWorld({ enqueuer: { enqueue: () => Promise.reject(new Error('queue down')) } });
  const id = await restingOnOverride(world);
  const before = await tablesOf(world);
  const response = await removeOverrideAs(world, 'admin1', world.t1.plain.repositoryId, id);
  expect(response.statusCode).toBe(500);
  expect(errorCodeOf(response)).toBe('internal_server_error');
  expect(response.body).not.toContain('queue down');
  expect(await tablesOf(world)).toEqual(before);
  expect(await overridesIn(world, world.t1.plain.repositoryId)).toEqual([[id, SEEDED_COMMIT]]);
  expect(await auditRows(world, 'commit_override.deleted')).toEqual([]);
});

test('a retry after the queue came back succeeds: the override is removed once, with one audit row and the job', async () => {
  const queue = switchableEnqueuer(fakeEnqueuer());
  const world = await overrideWorld({ enqueuer: queue });
  const id = await restingOnOverride(world);
  queue.failWith(new Error('connection lost'));
  const failed = await removeOverrideAs(world, 'admin1', world.t1.plain.repositoryId, id);
  queue.failWith(undefined);
  const retried = await removeOverrideAs(world, 'admin1', world.t1.plain.repositoryId, id);
  expect([failed.statusCode, retried.statusCode]).toEqual([500, 204]);
  expect(await overridesIn(world, world.t1.plain.repositoryId)).toEqual([]);
  expect(await auditRows(world, 'commit_override.deleted')).toHaveLength(1);
  expect(await numbersOf(world)).toEqual([101]);
});

test('a queue that fails after it took the job leaves no job behind, because the job commits with the removal or not at all', async () => {
  const world = await overrideWorld({ enqueuer: failingAfterSend(fakeEnqueuer(), new Error('connection lost')) });
  const id = await restingOnOverride(world);
  const response = await removeOverrideAs(world, 'admin1', world.t1.plain.repositoryId, id);
  expect(response.statusCode).toBe(500);
  expect(await jobCount(world.db)).toBe(0);
  expect(await overridesIn(world, world.t1.plain.repositoryId)).toEqual([[id, SEEDED_COMMIT]]);
});

test('the app that has no queue yet fails a removal that has a job to send, and deletes nothing; one with nothing to send succeeds', async () => {
  const world = await documentWorld();
  const { t1 } = world;
  await pointAt(world, t1.plain.repositoryId, t1.documentId);
  await setEnabled(world, t1.plain.repositoryId, true);
  const id = await overrideIdOf(world, t1.plain.repositoryId, SEEDED_COMMIT);
  await overriddenPullRequest(world, plainOf(t1), { prNumber: 101, unlinked: waivedBy(id) });
  const failed = await removeOverrideAs(world, 'admin1', t1.plain.repositoryId, id);
  expect(failed.statusCode).toBe(500);
  expect(await overridesIn(world, t1.plain.repositoryId)).toEqual([[id, SEEDED_COMMIT]]);
  await world.db.deleteFrom('pr_evaluations').where('pr_number', '=', 101).execute();
  expect((await removeOverrideAs(world, 'admin1', t1.plain.repositoryId, id)).statusCode).toBe(204);
});
