// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { seedTenant } from '../../adapters/db/test-support.ts';
import { FULL_NAME, INSTALLATION, REPOSITORY } from '../evaluate-pr/test-support.ts';
import { commitSha } from '../github-pull-contract/test-support.ts';
import { startGroupEvaluation } from '../merge-group/merge-group-rows.ts';
import { GitHubUnavailableError } from '../ports/github-errors.ts';
import { type DeadWorld, deadWorld } from './test-support.ts';

// A merge group whose evaluation died (E22-S01): its row is set to failure and the Check Run on its head SHA ends failure with
// the hint to remove the pull request from the queue and add it again, so the queue is never left waiting for a run that does
// not come. A group GitHub took down, a repository that is gone or not evaluated and a tenant that is not the job's are left alone.

const HEAD = commitSha(0x6001);
const BASE = commitSha(0x5000);
const JOB = {
  type: 'evaluate-merge-group',
  githubInstallationId: INSTALLATION,
  githubRepoId: REPOSITORY,
  headSha: HEAD,
  baseSha: BASE,
} as const;

const rowsOf = (world: DeadWorld) =>
  world.raw
    .selectFrom('merge_group_evaluations')
    .select(['installation_id', 'head_sha', 'result', 'details', 'destroyed_at'])
    .orderBy('id')
    .execute();

/** The row of the group of the tenant of the world, as the job leaves it when it dies after it started. */
async function startGroup(world: DeadWorld) {
  await startGroupEvaluation(
    world.raw,
    { installationId: world.tenant.installationId, repositoryId: world.tenant.repositoryId, headSha: HEAD },
    BASE,
  );
}

test('a group whose job died is set to failure and reported as errored on its head SHA, with the name GitHub gives the repository', async () => {
  const world = await deadWorld();
  await startGroup(world);
  expect(await world.runDead(JOB)).toEqual({ outcome: 'reported' });
  expect(await rowsOf(world)).toMatchObject([
    { head_sha: HEAD, result: 'failure', details: { outcome: 'failure', code: 'evaluation_failed' } },
  ]);
  expect(world.reporter.groups).toEqual([
    {
      target: { githubInstallationId: INSTALLATION, githubRepoId: REPOSITORY, fullName: FULL_NAME, headSha: HEAD },
      result: { state: 'errored' },
    },
  ]);
  expect(world.calls()).toEqual(['getRepositoryById']);
});

test('a job that died before it wrote a row leaves a failed row, so the report has a row to record its run on', async () => {
  const world = await deadWorld();
  expect(await world.runDead(JOB)).toEqual({ outcome: 'reported' });
  expect(await rowsOf(world)).toMatchObject([{ head_sha: HEAD, result: 'failure' }]);
  expect(world.reporter.groups).toHaveLength(1);
});

test('a verdict a retry stored before the job died is replaced by the failure, and a second run leaves one row', async () => {
  const world = await deadWorld();
  await startGroup(world);
  await world.raw.updateTable('merge_group_evaluations').set({ result: 'success', details: '{}' }).execute();
  await world.runDead(JOB);
  await world.runDead(JOB, { retryCount: 1 });
  expect((await rowsOf(world)).map((row) => row.result)).toEqual(['failure']);
  expect(world.reporter.groups).toHaveLength(2);
});

test('a group GitHub took down is left as it is and nothing is written for it', async () => {
  const world = await deadWorld();
  await startGroup(world);
  await world.raw.updateTable('merge_group_evaluations').set({ destroyed_at: new Date() }).execute();
  expect(await world.runDead(JOB)).toEqual({ outcome: 'skipped:merge_group_destroyed' });
  expect(await rowsOf(world)).toMatchObject([{ result: 'in_progress' }]);
  expect(world.reporter.groups).toEqual([]);
});

test('a repository GitHub no longer shows the installation ends the job as skipped, with the row as it was', async () => {
  const world = await deadWorld();
  await startGroup(world);
  world.fake.setRepositories(INSTALLATION, []);
  expect(await world.runDead(JOB)).toEqual({ outcome: 'skipped:repository_gone' });
  expect(await rowsOf(world)).toMatchObject([{ result: 'in_progress' }]);
  expect(world.reporter.groups).toEqual([]);
});

test('a repository that is not evaluated, and an installation GitHub no longer serves, end the job as skipped', async () => {
  const world = await deadWorld();
  await startGroup(world);
  await world.raw.updateTable('repositories').set({ enabled: false }).execute();
  expect(await world.runDead(JOB)).toEqual({ outcome: 'skipped:repository_disabled' });
  expect(world.calls()).toEqual([]);
  await world.raw.updateTable('repositories').set({ enabled: true }).execute();
  world.gate.refuse(INSTALLATION, 'deleted');
  expect(await world.runDead(JOB)).toEqual({ outcome: 'skipped:installation_unavailable' });
  expect(world.reporter.groups).toEqual([]);
});

test('an outage of GitHub fails the dead job, and a reporter that fails is retried to the same single row', async () => {
  const world = await deadWorld();
  await startGroup(world);
  world.fake.failNext('getRepositoryById', new GitHubUnavailableError('GitHub answered 500'));
  await expect(world.runDead(JOB)).rejects.toThrow('GitHub answered 500');
  expect(world.reporter.groups).toEqual([]);
  world.reporter.hooks.mergeGroup = () => Promise.reject(new GitHubUnavailableError('GitHub answered 502'));
  await expect(world.runDead(JOB, { retryCount: 1 })).rejects.toThrow('GitHub answered 502');
  world.reporter.hooks.mergeGroup = undefined;
  await world.runDead(JOB, { retryCount: 2 });
  expect((await rowsOf(world)).map((row) => row.result)).toEqual(['failure']);
});

test('with no GitHub App or no reporter the job fails before it reads anything', async () => {
  const world = await deadWorld({ evaluation: false });
  await startGroup(world);
  await expect(world.runDead(JOB)).rejects.toThrow('no GitHub App or no evaluation reporter is configured');
  expect((await rowsOf(world)).map((row) => row.result)).toEqual(['in_progress']);
});

test('a dead job naming installation A and a repository of B reads, writes and reports nothing of B', async () => {
  const world = await deadWorld();
  const other = await seedTenant(world.raw, 2);
  const stranger = await world.raw
    .selectFrom('repositories')
    .select('github_repo_id')
    .where('installation_id', '=', other.installationId)
    .executeTakeFirstOrThrow();
  expect(await world.runDead({ ...JOB, githubRepoId: parseGithubId(stranger.github_repo_id) })).toEqual({
    outcome: 'skipped:repository_not_found',
  });
  expect(world.calls()).toEqual([]);
  expect(await rowsOf(world)).toEqual([]);
  expect(world.reporter.groups).toEqual([]);
});

test('the failure of tenant A at a head SHA that tenant B also has leaves the group of B as it was', async () => {
  const world = await deadWorld();
  const other = await seedTenant(world.raw, 2);
  await startGroupEvaluation(
    world.raw,
    { installationId: other.installationId, repositoryId: other.repositoryId, headSha: HEAD },
    BASE,
  );
  await startGroup(world);
  await world.runDead(JOB);
  expect((await rowsOf(world)).map((row) => [row.installation_id, row.result])).toEqual([
    [other.installationId, 'in_progress'],
    [world.tenant.installationId, 'failure'],
  ]);
  expect(world.reporter.groups.map((group) => group.target.githubRepoId)).toEqual([REPOSITORY]);
});
