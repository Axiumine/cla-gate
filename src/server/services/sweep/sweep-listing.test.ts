// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test, vi } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { pullRequest } from '../github-pull-contract/test-support.ts';
import { listOpenPulls } from './open-pulls.ts';
import { HEAD, INSTALLATION, openPull, type SweepWorld, sweepWorld } from './test-support.ts';

// How much of a repository the sweep reads (E07-S08): 100 pull requests to a request, ten requests at most, and one request for a
// repository with none; and which repositories of an installation it reads at all.

function openMany(world: SweepWorld, count: number, fullName = 'org-1/repo'): void {
  for (let number = 1; number <= count; number += 1) {
    world.fake.addPullRequest(INSTALLATION, fullName, pullRequest(number, { headSha: HEAD }));
  }
}

const listings = (world: SweepWorld): number =>
  world.calls().filter((method) => method === 'listOpenPullRequests').length;

test('a repository costs one request per 100 open pull requests, and nothing else is asked of GitHub', async () => {
  const world = await sweepWorld();
  openMany(world, 250);
  await world.runSweep();
  expect(world.calls()).toEqual(['listOpenPullRequests', 'listOpenPullRequests', 'listOpenPullRequests']);
  expect(await world.queuedPulls()).toHaveLength(250);
});

test('a repository with no open pull request costs one request', async () => {
  const world = await sweepWorld();
  world.fake.addPullRequest(INSTALLATION, 'org-1/repo', pullRequest(7, { state: 'closed' }));
  await world.runSweep();
  expect(world.calls()).toEqual(['listOpenPullRequests']);
});

test('at most 1,000 pull requests of a repository are read in a run: the 10 newest pages, and the oldest are left for a later run', async () => {
  const world = await sweepWorld();
  openMany(world, 1030);
  await world.runSweep();
  expect(listings(world)).toBe(10);
  const queued = await world.queuedPulls();
  expect(queued).toHaveLength(1000);
  expect([Math.max(...queued), Math.min(...queued)]).toEqual([1030, 31]);
  expect(world.logs.lines()).toContainEqual(
    expect.objectContaining({ msg: 'sweep_installation.swept', listed: 1000, truncated: 1 }),
  );
});

test('a repository with exactly 1,000 open pull requests is read whole, and is not reported as cut', async () => {
  const world = await sweepWorld();
  openMany(world, 1000);
  await world.runSweep();
  expect(listings(world)).toBe(10);
  expect(await world.queuedPulls()).toHaveLength(1000);
  expect(world.logs.lines()).toContainEqual(
    expect.objectContaining({ msg: 'sweep_installation.swept', listed: 1000, truncated: 0 }),
  );
});

test("only the repositories with enforcement on that are still the installation's are read", async () => {
  const world = await sweepWorld();
  const extra = [
    { id: 9101, name: 'org-1/on', enabled: true, removed: false },
    { id: 9102, name: 'org-1/off', enabled: false, removed: false },
    { id: 9103, name: 'org-1/gone', enabled: true, removed: true },
  ];
  for (const repository of extra) {
    await world.raw
      .insertInto('repositories')
      .values({
        installation_id: world.tenant.installationId,
        github_repo_id: repository.id,
        full_name: repository.name,
        enabled: repository.enabled,
        removed_at: repository.removed ? new Date('2026-11-01T09:30:00Z') : null,
        cla_document_id: null,
      })
      .execute();
  }
  world.fake.setRepositories(INSTALLATION, [
    { id: parseGithubId(9000), fullName: 'org-1/repo' },
    ...extra.map((repository) => ({ id: parseGithubId(repository.id), fullName: repository.name })),
  ]);
  for (const repository of extra) {
    world.fake.addPullRequest(INSTALLATION, repository.name, pullRequest(1));
  }
  await world.runSweep();
  const queued = (await world.queued()).map(({ job }) =>
    job.type === 'evaluate-pr' ? [Number(job.githubRepoId), job.prNumber] : [],
  );
  expect(queued).toEqual([
    [9000, 7],
    [9101, 1],
  ]);
  expect(listings(world)).toBe(2);
});

test('the log of a sweep holds counts and numeric ids only: the repositories read, the pull requests queued', async () => {
  const world = await sweepWorld();
  openPull(world, 8);
  expect(await world.runSweep()).toEqual({ outcome: 'swept' });
  expect(world.logs.lines()).toContainEqual(
    expect.objectContaining({ msg: 'sweep_installation.swept', repositories: 1, queued: 2 }),
  );
});

function stubbedPages(world: SweepWorld, pages: { numbers: number[]; last: boolean }[]) {
  const spy = vi.spyOn(world.fake, 'listOpenPullRequests');
  for (const page of pages) {
    spy.mockResolvedValueOnce({
      pulls: page.numbers.map((number) => ({ number, state: 'open', headSha: HEAD })),
      last: page.last,
    });
  }
  return spy;
}

test('a pull request that moved from one page to the next while the pages were read is listed once', async () => {
  const world = await sweepWorld();
  stubbedPages(world, [
    { numbers: [9, 8], last: false },
    { numbers: [8, 7], last: true },
  ]);
  const read = await listOpenPulls(world.fake, INSTALLATION, 'org-1/repo');
  expect(read.pulls.map((pull) => pull.number)).toEqual([9, 8, 7]);
  expect(read.truncated).toBe(false);
});

test('a page with nothing on it ends the listing even if GitHub still names a next page, so a loop is never one request per page forever', async () => {
  const world = await sweepWorld();
  const spy = stubbedPages(world, [{ numbers: [], last: false }]);
  expect(await listOpenPulls(world.fake, INSTALLATION, 'org-1/repo')).toEqual({ pulls: [], truncated: false });
  expect(spy).toHaveBeenCalledOnce();
});

test('a listing asks for the pages in order from the first, for the repository and the installation given', async () => {
  const world = await sweepWorld();
  const spy = stubbedPages(world, [
    { numbers: [3], last: false },
    { numbers: [2], last: true },
  ]);
  await listOpenPulls(world.fake, INSTALLATION, 'org-1/repo');
  expect(spy.mock.calls).toEqual([
    [INSTALLATION, 'org-1/repo', 1],
    [INSTALLATION, 'org-1/repo', 2],
  ]);
});
