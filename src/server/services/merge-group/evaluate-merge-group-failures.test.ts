// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test, vi } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { evaluateWorld, FULL_NAME, INSTALLATION } from '../evaluate-pr/test-support.ts';
import { commit, pullRequest } from '../github-pull-contract/test-support.ts';
import { GitHubRateLimitedError, GitHubResponseError, GitHubUnavailableError } from '../ports/github-errors.ts';
import { ReportRejectedError } from '../ports/reporter.ts';
import { MergeGroupMemberMovedError } from './evaluate-merge-group.ts';
import { markGroupDestroyed } from './merge-group-rows.ts';
import { addGroup, destroyGroup, groupJob, groupRows, prHead, runGroup } from './test-support.ts';

// What goes wrong in the `evaluate-merge-group` job (E22-S01): nothing that GitHub, the database or the reporter fail at ever
// becomes a pass. A failure throws, the queue retries the job, and the only things written before the verdict are the row in
// progress and nothing on the Check Run.

test.each([
  ['getPullRequest', new GitHubUnavailableError('GitHub answered 502')],
  ['getPullRequest', new GitHubRateLimitedError(30, 'secondary')],
  ['getPullRequest', new GitHubResponseError('GET /pulls', ['head'])],
  ['listPullRequestCommits', new GitHubUnavailableError('GitHub answered 503')],
  ['compareCommits', new GitHubUnavailableError('GitHub answered 500')],
  ['listRepositoryCommits', new GitHubUnavailableError('GitHub answered 504')],
  ['listPullRequestsForCommit', new GitHubUnavailableError('GitHub answered 502')],
] as const)(
  'GitHub failing at %s (%s) makes the job fail and be retried, and nothing that says success is ever written',
  async (method, error) => {
    const world = await evaluateWorld();
    const scene = addGroup(world, [41, 42, 43]);
    world.fake.failNext(method, error);
    await expect(runGroup(world, groupJob(scene))).rejects.toBe(error);
    expect(world.reporter.groups).toEqual([]);
    expect((await groupRows(world)).map((row) => row.result)).toEqual(['in_progress']);
    expect(world.evaluate.mock.calls.length).toBeLessThan(3);
  },
);

test('the retry of a job that failed on GitHub evaluates the group again and reports success once', async () => {
  const world = await evaluateWorld();
  const scene = addGroup(world, [41, 42]);
  world.fake.failNext('getPullRequest', new GitHubUnavailableError('GitHub answered 502'));
  await expect(runGroup(world, groupJob(scene))).rejects.toThrow('GitHub answered 502');
  expect(await runGroup(world, groupJob(scene))).toEqual({ outcome: 'evaluated' });
  expect(world.reporter.groups.map((report) => report.result)).toEqual([{ state: 'passed', pullRequests: 2 }]);
  expect((await groupRows(world)).map((row) => row.result)).toEqual(['success']);
});

test('a failing member is not hidden by a member whose fetch fails: the job fails, it does not report the passing ones', async () => {
  const world = await evaluateWorld();
  const scene = addGroup(world, [41, 42]);
  world.fake.failNext('getPullRequest', new GitHubUnavailableError('GitHub answered 502'));
  await expect(runGroup(world, groupJob(scene))).rejects.toThrow();
  expect(world.reporter.groups).toEqual([]);
});

test('a pull request that moved while its commits were read makes the job fail and be retried, with nothing reported', async () => {
  const world = await evaluateWorld();
  const scene = addGroup(world, [41]);
  // The pull request says two commits and lists one: the listing does not add up, so it is read again, and the head moved by then.
  world.fake.addPullRequest(INSTALLATION, FULL_NAME, pullRequest(41, { headSha: prHead(41), commitCount: 2 }));
  world.fake.beforeNext('listPullRequestCommits', () => {
    world.fake.addPullRequest(INSTALLATION, FULL_NAME, pullRequest(41, { headSha: prHead(99), commitCount: 2 }));
    return Promise.resolve();
  });
  await expect(runGroup(world, groupJob(scene))).rejects.toBeInstanceOf(MergeGroupMemberMovedError);
  expect(world.reporter.groups).toEqual([]);
  expect((await groupRows(world)).map((row) => row.result)).toEqual(['in_progress']);
});

test('a listing that still does not add up on the second look fails the job: the commits of the pull request are never guessed', async () => {
  const world = await evaluateWorld();
  const scene = addGroup(world, [41]);
  world.fake.addPullRequest(INSTALLATION, FULL_NAME, pullRequest(41, { headSha: prHead(41), commitCount: 3 }));
  world.fake.setPullRequestCommits(INSTALLATION, FULL_NAME, 41, [commit(41, { sha: prHead(41) })]);
  await expect(runGroup(world, groupJob(scene))).rejects.toThrow('do not add up');
  expect(world.reporter.groups).toEqual([]);
});

test('a group GitHub took down before the job runs again is not evaluated, read or reported', async () => {
  const world = await evaluateWorld();
  const scene = addGroup(world, [41]);
  await runGroup(world, groupJob(scene));
  await destroyGroup(world, scene);
  world.fake.calls.length = 0;
  expect(await runGroup(world, groupJob(scene))).toEqual({ outcome: 'skipped:merge_group_destroyed' });
  expect(world.fake.calls.map((call) => call.method)).toEqual(['getRepositoryById']);
  expect(world.reporter.groups).toHaveLength(1);
});

test('a group taken down while it is being evaluated is checked again immediately before the write, and nothing is written for it', async () => {
  const world = await evaluateWorld();
  const scene = addGroup(world, [41, 42]);
  world.fake.beforeNext('getPullRequest', () => destroyGroup(world, scene));
  expect(await runGroup(world, groupJob(scene))).toEqual({ outcome: 'skipped:merge_group_destroyed' });
  expect(world.reporter.groups).toEqual([]);
  const [row] = await groupRows(world);
  expect(row).toMatchObject({ result: 'in_progress', details: {} });
  expect(row?.destroyed_at).toBeInstanceOf(Date);
  expect(world.timeline.at(-1)).not.toBe('reporter.merge_group');
});

test('a group taken down after the verdict was stored is found by the reporter, which writes nothing: the job ends as skipped', async () => {
  const world = await evaluateWorld();
  const scene = addGroup(world, [41]);
  vi.spyOn(world.reporter, 'mergeGroup').mockImplementationOnce(async () => {
    await destroyGroup(world, scene);
    return { status: 'skipped', reason: 'merge_group_destroyed' };
  });
  expect(await runGroup(world, groupJob(scene))).toEqual({ outcome: 'skipped:merge_group_destroyed' });
  expect(world.reporter.groups).toEqual([]);
});

test('a group destroyed before its first job ran is not evaluated at all: the tombstone ends the job with no pull request read', async () => {
  const world = await evaluateWorld();
  const scene = addGroup(world, [41, 42]);
  await markGroupDestroyed(world.raw, {
    githubInstallationId: scene.installation,
    githubRepoId: scene.repository,
    headSha: scene.head,
    baseSha: scene.base,
  });
  world.fake.calls.length = 0;
  expect(await runGroup(world, groupJob(scene))).toEqual({ outcome: 'skipped:merge_group_destroyed' });
  expect(world.fake.calls.map((call) => call.method)).toEqual(['getRepositoryById']);
  expect(world.evaluate).not.toHaveBeenCalled();
  expect(world.reporter.groups).toEqual([]);
  expect((await groupRows(world)).map((row) => [row.result, row.destroyed_at instanceof Date])).toEqual([
    ['in_progress', true],
  ]);
});

test.each([
  ['installation_rejected', "update installations set admission_status = 'rejected'"],
  ['installation_deleted', 'update installations set deleted_at = now()'],
  ['installation_suspended', 'update installations set suspended_at = now()'],
  ['repository_removed', 'update repositories set removed_at = now()'],
  ['repository_disabled', 'update repositories set enabled = false'],
] as const)(
  'a tenant that is %s ends the job as skipped, with no GitHub call and nothing written',
  async (reason, statement) => {
    const world = await evaluateWorld();
    const scene = addGroup(world, [41]);
    await sql.raw(statement).execute(world.raw);
    expect(await runGroup(world, groupJob(scene))).toEqual({ outcome: `skipped:${reason}` });
    expect(world.fake.calls).toEqual([]);
    expect(world.reporter.groups).toEqual([]);
    expect(await groupRows(world)).toEqual([]);
    expect(world.logs.lines()).toContainEqual(expect.objectContaining({ msg: 'evaluate_merge_group.skipped', reason }));
  },
);

test.each([
  ['an installation nobody stored', { githubInstallationId: parseGithubId(999_999) }, 'installation_not_found'],
  ['a repository the installation never had', { githubRepoId: parseGithubId(123_456) }, 'repository_not_found'],
])('%s is not evaluated: the job ends as skipped with no GitHub call', async (_name, change, reason) => {
  const world = await evaluateWorld();
  const scene = addGroup(world, [41]);
  expect(await runGroup(world, groupJob(scene, change))).toEqual({ outcome: `skipped:${reason}` });
  expect(world.fake.calls).toEqual([]);
  expect(await groupRows(world)).toEqual([]);
});

test('a repository GitHub no longer shows the installation ends the job as skipped, with no row', async () => {
  const world = await evaluateWorld();
  const scene = addGroup(world, [41]);
  world.fake.setRepositories(INSTALLATION, []);
  expect(await runGroup(world, groupJob(scene))).toEqual({ outcome: 'skipped:repository_gone' });
  expect(await groupRows(world)).toEqual([]);
  expect(world.reporter.groups).toEqual([]);
});

test('an installation that GitHub or the gate no longer serves ends the job as skipped', async () => {
  const world = await evaluateWorld();
  const scene = addGroup(world, [41]);
  world.fake.suspend(INSTALLATION, new Date('2026-11-01T00:00:00Z'));
  expect(await runGroup(world, groupJob(scene))).toEqual({ outcome: 'skipped:installation_unavailable' });
  expect(world.reporter.groups).toEqual([]);
});

test('a report that the reporter had to skip ends the job as skipped for the same reason', async () => {
  const world = await evaluateWorld();
  const scene = addGroup(world, [41]);
  vi.spyOn(world.reporter, 'mergeGroup').mockResolvedValueOnce({ status: 'skipped', reason: 'repository_gone' });
  expect(await runGroup(world, groupJob(scene))).toEqual({ outcome: 'skipped:repository_gone' });
});

test('a report that GitHub refuses fails the job, the stored verdict stays and the retry reports it', async () => {
  const world = await evaluateWorld();
  const scene = addGroup(world, [41]);
  vi.spyOn(world.reporter, 'mergeGroup').mockRejectedValueOnce(new ReportRejectedError('checks_permission_missing'));
  await expect(runGroup(world, groupJob(scene))).rejects.toBeInstanceOf(ReportRejectedError);
  expect((await groupRows(world)).map((row) => row.result)).toEqual(['success']);
  expect(await runGroup(world, groupJob(scene))).toEqual({ outcome: 'evaluated' });
});

test('a failure of the database is not swallowed: the job fails with it', async () => {
  const world = await evaluateWorld();
  const scene = addGroup(world, [41]);
  await world.raw.schema.dropTable('merge_group_evaluations').cascade().execute();
  await expect(runGroup(world, groupJob(scene))).rejects.toThrow();
  expect(world.reporter.groups).toEqual([]);
});
