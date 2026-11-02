// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { FULL_NAME, INSTALLATION, JOB, PR_NUMBER, REPOSITORY } from '../evaluate-pr/test-support.ts';
import { commitSha, pullRequest } from '../github-pull-contract/test-support.ts';
import { GitHubUnavailableError } from '../ports/github-errors.ts';
import { deadWorld, logged } from './test-support.ts';

// A pull request whose evaluation died (E07-S05): the head SHA is read from GitHub now, the row of the head SHA becomes
// `failure` with a code that names nobody, and the reporter completes the Check Run as failed. Once per attempt, safely twice.

const OUTAGE = new GitHubUnavailableError('GitHub answered 500');
const ANY_NUMBER: unknown = expect.any(Number);

test('a dead evaluate-pr sets the row of the head SHA to failure with a code only, and the reporter fails the Check Run', async () => {
  const world = await deadWorld();
  expect(await world.runDead(JOB)).toEqual({ outcome: 'reported' });
  const rows = await world.rows();
  expect(rows).toEqual([
    {
      id: ANY_NUMBER,
      pr_number: PR_NUMBER,
      head_sha: commitSha(2),
      result: 'failure',
      details: { code: 'evaluation_failed' },
      check_run_id: null,
    },
  ]);
  expect(world.reporter.failures).toEqual([
    {
      code: 'evaluation_failed',
      target: {
        githubInstallationId: INSTALLATION,
        githubRepoId: REPOSITORY,
        fullName: FULL_NAME,
        prNumber: PR_NUMBER,
        headSha: commitSha(2),
        trigger: 'pull_request',
        evaluationId: rows[0]?.id,
      },
    },
  ]);
  expect(world.reporter.startedTargets).toEqual([]);
  expect(world.reporter.published).toEqual([]);
});

test('the order is the repository, the pull request, the row, then the report: the Check Run is only touched once the row says why', async () => {
  const world = await deadWorld();
  await world.runDead(JOB);
  expect(world.timeline.filter((step) => !step.startsWith('db:select'))).toEqual([
    'gh:getRepositoryById',
    'gh:getPullRequest',
    'db:insert pr_evaluations',
    'reporter.failed',
  ]);
});

test('the trigger of the dead job is the one the report carries, so a recheck that died is reported as a recheck', async () => {
  const world = await deadWorld();
  await world.runDead({ ...JOB, trigger: 'recheck' });
  expect(world.reporter.failures.map((failure) => failure.target.trigger)).toEqual(['recheck']);
});

test('the head SHA is the one GitHub shows now: a push since the job died moves the report to the new head', async () => {
  const world = await deadWorld();
  world.fake.addPullRequest(INSTALLATION, FULL_NAME, pullRequest(PR_NUMBER, { headSha: commitSha(3) }));
  await world.runDead(JOB);
  expect(world.reporter.failures.map((failure) => failure.target.headSha)).toEqual([commitSha(3)]);
  expect((await world.rows()).map((row) => [row.head_sha, row.result])).toEqual([[commitSha(3), 'failure']]);
});

test('a row that is in progress becomes the failure, keeping its id and the Check Run it holds; nothing else is created', async () => {
  const world = await deadWorld();
  const row = await world.raw
    .insertInto('pr_evaluations')
    .values({
      installation_id: world.tenant.installationId,
      repository_id: world.tenant.repositoryId,
      pr_number: PR_NUMBER,
      head_sha: commitSha(2),
      result: 'in_progress',
      details: '{}',
      check_run_id: 555,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await world.runDead(JOB);
  expect(await world.rows()).toEqual([
    {
      id: row.id,
      pr_number: PR_NUMBER,
      head_sha: commitSha(2),
      result: 'failure',
      details: { code: 'evaluation_failed' },
      check_run_id: 555,
    },
  ]);
  expect(world.reporter.failures.map((failure) => failure.target.evaluationId)).toEqual([row.id]);
});

test('the handler runs again after a failure and leaves one row: the report is made once per attempt and is idempotent', async () => {
  const world = await deadWorld();
  world.reporter.hooks.failed = () => Promise.reject(OUTAGE);
  await expect(world.runDead(JOB)).rejects.toBe(OUTAGE);
  expect(await world.rows()).toHaveLength(1);
  world.reporter.hooks.failed = undefined;
  expect(await world.runDead(JOB, { retryCount: 1 })).toEqual({ outcome: 'reported' });
  expect(await world.rows()).toHaveLength(1);
  expect(world.reporter.failures).toHaveLength(2);
});

test('it never marks a delivery processed and never starts or publishes an evaluation', async () => {
  const world = await deadWorld();
  await world.runDead(JOB);
  expect(world.timeline.some((step) => step === 'reporter.started' || step === 'reporter.publish')).toBe(false);
  expect(world.timeline.some((step) => step.includes('webhook_deliveries'))).toBe(false);
});

test('the dead job is logged at error with its ids and what was done, and the log holds no body and no name', async () => {
  const world = await deadWorld();
  await world.runDead({ ...JOB, deliveryId: '7c9e6679-7425-40de-944b-e07fc1f90ae7' });
  const [line, ...others] = logged(world, 'job.dead_lettered');
  expect(others).toEqual([]);
  expect(line).toMatchObject({
    level: 50,
    jobId: 'dead-1',
    type: 'evaluate-pr',
    githubInstallationId: INSTALLATION,
    githubRepoId: REPOSITORY,
    prNumber: PR_NUMBER,
    outcome: 'reported',
  });
  expect(world.logs.text()).not.toContain(FULL_NAME);
});

test('an outage of GitHub at the repository or at the pull request fails the job with nothing written and nothing reported', async () => {
  for (const method of ['getRepositoryById', 'getPullRequest'] as const) {
    const world = await deadWorld();
    world.fake.failNext(method, OUTAGE);
    await expect(world.runDead(JOB)).rejects.toBe(OUTAGE);
    expect(await world.rows()).toEqual([]);
    expect(world.reporter.failures).toEqual([]);
  }
});

test('a pull request number GitHub does not have, or one that closed, ends the job without a report', async () => {
  const world = await deadWorld();
  expect(await world.runDead({ ...JOB, prNumber: 99 })).toEqual({ outcome: 'skipped:pull_request_not_found' });
  world.fake.addPullRequest(INSTALLATION, FULL_NAME, pullRequest(PR_NUMBER, { state: 'closed' }));
  expect(await world.runDead(JOB)).toEqual({ outcome: 'skipped:pull_request_closed' });
  expect(world.reporter.failures).toEqual([]);
  expect(await world.rows()).toEqual([]);
});

test('a repository GitHub no longer shows the installation ends the job without a report', async () => {
  const world = await deadWorld();
  world.fake.setRepositories(INSTALLATION, []);
  expect(await world.runDead(JOB)).toEqual({ outcome: 'skipped:repository_gone' });
  expect(world.reporter.failures).toEqual([]);
});

test('an installation GitHub or the instance no longer serves ends the job as skipped, not as a failure to retry', async () => {
  const world = await deadWorld();
  world.gate.refuse(INSTALLATION, 'suspended');
  expect(await world.runDead(JOB)).toEqual({ outcome: 'skipped:installation_unavailable' });
  expect(world.reporter.failures).toEqual([]);
});

test('with no GitHub App or no reporter the job fails, so the queue retries it under the same bounds', async () => {
  const world = await deadWorld({ evaluation: false });
  await expect(world.runDead(JOB)).rejects.toThrow('no GitHub App or no evaluation reporter is configured');
  expect(world.calls()).toEqual([]);
  expect(await world.rows()).toEqual([]);
});

test('a job that names a repository by an id this installation never had reports nothing and asks GitHub nothing', async () => {
  const world = await deadWorld();
  expect(await world.runDead({ ...JOB, githubRepoId: parseGithubId(123_456) })).toEqual({
    outcome: 'skipped:repository_not_found',
  });
  expect(world.calls()).toEqual([]);
});
