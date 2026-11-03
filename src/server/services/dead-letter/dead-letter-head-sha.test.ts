// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { FULL_NAME, INSTALLATION, REPOSITORY } from '../evaluate-pr/test-support.ts';
import { commitSha } from '../github-pull-contract/test-support.ts';
import { GitHubUnavailableError } from '../ports/github-errors.ts';
import { type DeadWorld, deadWorld } from './test-support.ts';

// A re-run of a Check Run whose evaluation died (E07-S05): the job carries the head SHA, and the pull requests it
// belongs to are the evaluations stored at it. Each of them is failed, so none of the checks of that SHA stays `in_progress`.

const HEAD = commitSha(2);
const JOB = {
  type: 'evaluate-head-sha',
  githubInstallationId: INSTALLATION,
  githubRepoId: REPOSITORY,
  headSha: HEAD,
} as const;

/** Stores an evaluation of pull request `prNumber` at `HEAD` for the tenant of the world, as the evaluation job would have. */
async function store(world: DeadWorld, prNumber: number, result: 'in_progress' | 'success' = 'in_progress') {
  await world.raw
    .insertInto('pr_evaluations')
    .values({
      installation_id: world.tenant.installationId,
      repository_id: world.tenant.repositoryId,
      pr_number: prNumber,
      head_sha: HEAD,
      result,
      details: '{}',
    })
    .execute();
}

test('every pull request that has an evaluation at the head SHA is set to failure and reported, in the order of the rows', async () => {
  const world = await deadWorld();
  await store(world, 7);
  await store(world, 12, 'success');
  expect(await world.runDead(JOB)).toEqual({ outcome: 'reported' });
  expect((await world.rows()).map((row) => [row.pr_number, row.result, row.details])).toEqual([
    [7, 'failure', { code: 'evaluation_failed' }],
    [12, 'failure', { code: 'evaluation_failed' }],
  ]);
  expect(
    world.reporter.failures.map(({ target, code }) => [target.prNumber, target.headSha, target.trigger, code]),
  ).toEqual([
    [7, HEAD, 'check_rerequested', 'evaluation_failed'],
    [12, HEAD, 'check_rerequested', 'evaluation_failed'],
  ]);
  expect(world.reporter.failures.map(({ target }) => target.fullName)).toEqual([FULL_NAME, FULL_NAME]);
});

test('the repository is read from GitHub once, after the rows are found, and only to name it as it is now', async () => {
  const world = await deadWorld();
  await store(world, 7);
  await store(world, 12);
  await world.runDead(JOB);
  expect(world.calls()).toEqual(['getRepositoryById']);
});

test('a head SHA with no stored evaluation has no Check Run of ours to fail: the job ends without asking GitHub anything', async () => {
  const world = await deadWorld();
  expect(await world.runDead(JOB)).toEqual({ outcome: 'skipped:no_evaluation' });
  expect(world.calls()).toEqual([]);
  expect(world.reporter.failures).toEqual([]);
});

test('an evaluation at another head SHA of the same repository is left alone', async () => {
  const world = await deadWorld();
  await store(world, 7);
  await world.raw
    .insertInto('pr_evaluations')
    .values({
      installation_id: world.tenant.installationId,
      repository_id: world.tenant.repositoryId,
      pr_number: 9,
      head_sha: commitSha(5),
      result: 'success',
      details: '{}',
    })
    .execute();
  await world.runDead(JOB);
  expect((await world.rows()).map((row) => [row.pr_number, row.result])).toEqual([
    [7, 'failure'],
    [9, 'success'],
  ]);
});

test('a repository GitHub no longer shows the installation ends the job without a report', async () => {
  const world = await deadWorld();
  await store(world, 7);
  world.fake.setRepositories(INSTALLATION, []);
  expect(await world.runDead(JOB)).toEqual({ outcome: 'skipped:repository_gone' });
  expect(world.reporter.failures).toEqual([]);
  expect((await world.rows()).map((row) => row.result)).toEqual(['in_progress']);
});

test('an installation that is not evaluated ends the job as skipped with no GitHub call, and one GitHub no longer serves too', async () => {
  const world = await deadWorld();
  await store(world, 7);
  await world.raw.updateTable('repositories').set({ enabled: false }).execute();
  expect(await world.runDead(JOB)).toEqual({ outcome: 'skipped:repository_disabled' });
  expect(world.calls()).toEqual([]);
  await world.raw.updateTable('repositories').set({ enabled: true }).execute();
  world.gate.refuse(INSTALLATION, 'deleted');
  expect(await world.runDead(JOB)).toEqual({ outcome: 'skipped:installation_unavailable' });
});

test('an outage of GitHub fails the job, and a reporter that fails after the first row is retried to the same single rows', async () => {
  const world = await deadWorld();
  await store(world, 7);
  await store(world, 12);
  world.fake.failNext('getRepositoryById', new GitHubUnavailableError('GitHub answered 500'));
  await expect(world.runDead(JOB)).rejects.toThrow('GitHub answered 500');
  expect(world.reporter.failures).toEqual([]);
  world.reporter.hooks.failed = (target) =>
    target.prNumber === 12 ? Promise.reject(new GitHubUnavailableError('GitHub answered 502')) : Promise.resolve();
  await expect(world.runDead(JOB, { retryCount: 1 })).rejects.toThrow('GitHub answered 502');
  world.reporter.hooks.failed = undefined;
  await world.runDead(JOB, { retryCount: 2 });
  expect(await world.rows()).toHaveLength(2);
  expect((await world.rows()).map((row) => row.result)).toEqual(['failure', 'failure']);
});

test('with no GitHub App or no reporter the job fails before it reads anything', async () => {
  const world = await deadWorld({ evaluation: false });
  await store(world, 7);
  await expect(world.runDead(JOB)).rejects.toThrow('no GitHub App or no evaluation reporter is configured');
  expect((await world.rows()).map((row) => row.result)).toEqual(['in_progress']);
});
