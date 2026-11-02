// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { GitHubForbiddenError, GitHubNotFoundError, GitHubRateLimitedError } from '../ports/github-errors.ts';
import { sweepInstallation } from './sweep-installation.ts';
import { addNeighbour, callsFor, INSTALLATION, SWEEP_JOB, type SweepWorld, sweepWorld } from './test-support.ts';

// What goes wrong while an installation is swept (E07-S08): one repository's failure does not stop the next one, the budget of the
// installation does stop the job, and no installation's failure reaches another's job.

/** A second repository of the tenant, enabled, with an open pull request 1, after the repository of the world in id order. */
async function addSecondRepository(world: SweepWorld): Promise<void> {
  await world.raw
    .insertInto('repositories')
    .values({
      installation_id: world.tenant.installationId,
      github_repo_id: 9001,
      full_name: 'org-1/second',
      enabled: true,
      cla_document_id: null,
    })
    .execute();
  world.fake.setRepositories(INSTALLATION, [
    { id: parseGithubId(9000), fullName: 'org-1/repo' },
    { id: parseGithubId(9001), fullName: 'org-1/second' },
  ]);
  world.fake.addPullRequest(INSTALLATION, 'org-1/second', {
    number: 1,
    state: 'open',
    draft: false,
    headSha: 'a'.repeat(40),
    baseSha: 'b'.repeat(40),
    opener: { id: parseGithubId(7), login: 'user-7', type: 'User' },
    commitCount: 1,
  });
}

const failed = (world: SweepWorld) => world.logs.lines().filter((line) => line['msg'] === 'sweep.repository_failed');

test('a rate limit ends the job with the rate limit, so the queue retries it later, and the repositories before it were swept', async () => {
  const world = await sweepWorld();
  await addSecondRepository(world);
  const limit = new GitHubRateLimitedError(3600, 'primary');
  world.fake.failNext('listOpenPullRequests', new Error('GitHub answered 502'));
  world.fake.failNext('listOpenPullRequests', limit);
  // the first repository fails with an ordinary error and is logged; the second meets the limit and ends the job
  await expect(world.runSweep()).rejects.toBe(limit);
  expect(failed(world)).toHaveLength(1);
  expect(world.logs.lines().filter((line) => line['msg'] === 'sweep_installation.swept')).toEqual([]);
});

test('a repository that fails is logged and the next one is swept all the same: the job ends partial, and the failure is not an installation-wide one', async () => {
  const world = await sweepWorld();
  await addSecondRepository(world);
  world.fake.failNext('listOpenPullRequests', new Error('GitHub answered 502'));
  expect(await world.runSweep()).toEqual({ outcome: 'partial' });
  expect(await world.queuedPulls()).toEqual([1]);
  expect(failed(world)).toHaveLength(1);
  expect(failed(world)[0]).toMatchObject({ githubRepoId: 9000, err: { message: 'GitHub answered 502' } });
});

test('a limit hit by one installation fails its job only: the sweep of another installation, run after it, finishes', async () => {
  const world = await sweepWorld();
  const neighbour = await addNeighbour(world, 2);
  const limit = new GitHubRateLimitedError(120, 'secondary');
  world.fake.failNext('listOpenPullRequests', limit);
  const first = await Promise.allSettled([world.runSweep(SWEEP_JOB, 'a')]);
  const second = await world.runSweep(
    { type: 'sweep-installation', githubInstallationId: neighbour.githubInstallationId },
    'b',
  );
  expect(first).toEqual([{ status: 'rejected', reason: limit }]);
  expect(second).toEqual({ outcome: 'swept' });
  expect(
    (await world.queued()).map(({ job }) => (job.type === 'evaluate-pr' ? job.githubInstallationId : undefined)),
  ).toEqual([neighbour.githubInstallationId]);
});

test('a repository GitHub no longer shows the installation is marked removed, and the sweep goes on and never asks for it again', async () => {
  const world = await sweepWorld();
  await addSecondRepository(world);
  world.fake.setRepositories(INSTALLATION, [{ id: parseGithubId(9001), fullName: 'org-1/second' }]);
  expect(await world.runSweep()).toEqual({ outcome: 'swept' });
  const removed = await world.raw
    .selectFrom('repositories')
    .select(['github_repo_id', 'removed_at'])
    .orderBy('id')
    .execute();
  expect(removed.map((row) => [row.github_repo_id, row.removed_at !== null])).toEqual([
    [9000, true],
    [9001, false],
  ]);
  expect(world.logs.lines()).toContainEqual(
    expect.objectContaining({ msg: 'sweep.repository_unreachable', status: 'removed' }),
  );
  expect(await world.queuedPulls()).toEqual([1]);
  world.fake.calls.length = 0;
  await world.runSweep(SWEEP_JOB, 'sweep-2');
  expect(world.fake.calls.map((call) => call.method)).toEqual(['listOpenPullRequests']);
});

test('a refusal of the listing (403) is read through the snapshot refresh, and a repository that GitHub still shows stays', async () => {
  const world = await sweepWorld();
  world.fake.failNext('listOpenPullRequests', new GitHubForbiddenError('GET /repos/{owner}/{repo}/pulls'));
  expect(await world.runSweep()).toEqual({ outcome: 'swept' });
  expect(world.calls()).toEqual(['listOpenPullRequests', 'getRepositoryById']);
  expect(world.logs.lines()).toContainEqual(
    expect.objectContaining({ msg: 'sweep.repository_unreachable', status: 'unchanged' }),
  );
  expect(
    (await world.raw.selectFrom('repositories').select('removed_at').execute()).map((row) => row.removed_at),
  ).toEqual([null]);
});

test('a repository that was renamed on GitHub is stored under its new name by the refresh, and the next sweep lists it', async () => {
  const world = await sweepWorld();
  world.fake.setRepositories(INSTALLATION, [{ id: parseGithubId(9000), fullName: 'org-1/renamed' }]);
  world.fake.addPullRequest(INSTALLATION, 'org-1/renamed', {
    number: 7,
    state: 'open',
    draft: false,
    headSha: 'c'.repeat(40),
    baseSha: 'b'.repeat(40),
    opener: { id: parseGithubId(7), login: 'user-7', type: 'User' },
    commitCount: 1,
  });
  await world.runSweep();
  expect(await world.queued()).toEqual([]);
  expect(
    (await world.raw.selectFrom('repositories').select('full_name').execute()).map((row) => row.full_name),
  ).toEqual(['org-1/renamed']);
  await world.runSweep(SWEEP_JOB, 'sweep-2');
  expect(await world.queuedPulls()).toEqual([7]);
});

test('a refresh that fails is a failure of the repository, as any other', async () => {
  const world = await sweepWorld();
  world.fake.failNext('listOpenPullRequests', new GitHubNotFoundError('GET /repos/{owner}/{repo}/pulls'));
  world.fake.failNext('getRepositoryById', new Error('GitHub answered 502'));
  expect(await world.runSweep()).toEqual({ outcome: 'partial' });
  expect(failed(world)).toHaveLength(1);
  expect(failed(world)[0]).toMatchObject({ err: { message: 'GitHub answered 502' } });
});

test('a refresh that meets the limit of the installation ends the job with it', async () => {
  const world = await sweepWorld();
  const limit = new GitHubRateLimitedError(60, 'primary');
  world.fake.failNext('listOpenPullRequests', new GitHubNotFoundError('GET /repos/{owner}/{repo}/pulls'));
  world.fake.failNext('getRepositoryById', limit);
  await expect(world.runSweep()).rejects.toBe(limit);
});

test('an installation GitHub or the gate stops serving while the job runs ends the job as skipped, with nothing sent', async () => {
  const world = await sweepWorld();
  world.gate.refuse(INSTALLATION, 'suspended');
  expect(await world.runSweep()).toEqual({ outcome: 'skipped:installation_unavailable' });
  expect(await world.queued()).toEqual([]);
});

test('an installation GitHub no longer has ends the job as skipped too', async () => {
  const world = await sweepWorld();
  world.fake.removeInstallation(INSTALLATION);
  expect(await world.runSweep()).toEqual({ outcome: 'skipped:installation_unavailable' });
});

test('a job that is being shut down fails with the reason of the shutdown whatever failed, and does not count the failure against a repository', async () => {
  const world = await sweepWorld();
  const reason = new Error('the worker is shutting down');
  const controller = new AbortController();
  world.fake.beforeNext('listOpenPullRequests', () => {
    controller.abort(reason);
    return Promise.resolve();
  });
  world.fake.failNext('listOpenPullRequests', new Error('socket closed'));
  await expect(
    sweepInstallation(world.sweepPorts, SWEEP_JOB, { ...world.context(), signal: controller.signal }),
  ).rejects.toThrow('socket closed');
  expect(failed(world)).toEqual([]);
});

test('a job that is being shut down fails with the shutdown also when it was the refresh that failed', async () => {
  const world = await sweepWorld();
  const controller = new AbortController();
  world.fake.failNext('listOpenPullRequests', new GitHubNotFoundError('GET /repos/{owner}/{repo}/pulls'));
  world.fake.beforeNext('getRepositoryById', () => {
    controller.abort(new Error('the worker is shutting down'));
    return Promise.resolve();
  });
  world.fake.failNext('getRepositoryById', new Error('socket closed'));
  await expect(
    sweepInstallation(world.sweepPorts, SWEEP_JOB, { ...world.context(), signal: controller.signal }),
  ).rejects.toThrow('socket closed');
  expect(callsFor(world, INSTALLATION)).toBe(2);
});
