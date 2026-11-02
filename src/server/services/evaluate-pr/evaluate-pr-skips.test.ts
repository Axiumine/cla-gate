// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { seedTenant } from '../../adapters/db/test-support.ts';
import { pullRequest } from '../github-pull-contract/test-support.ts';
import {
  defaultCommits,
  engineInput,
  evaluateWorld,
  FULL_NAME,
  INSTALLATION,
  JOB,
  PR_NUMBER,
  REPOSITORY,
  reported,
} from './test-support.ts';

// The job ends before it asks GitHub anything (E07-S04): the payload names a pull request by ids, and the stored tenant
// decides whether it is evaluated at all.

test('a repository of another installation ends the job as skipped: repository_not_found, with no GitHub call and nothing written', async () => {
  const world = await evaluateWorld();
  const other = await seedTenant(world.raw, 2);
  const stranger = await world.raw
    .selectFrom('repositories')
    .select('github_repo_id')
    .where('installation_id', '=', other.installationId)
    .executeTakeFirstOrThrow();
  const outcome = await world.run({ ...JOB, githubRepoId: parseGithubId(stranger.github_repo_id) });
  expect(outcome).toEqual({ outcome: 'skipped:repository_not_found' });
  expect(world.calls()).toEqual([]);
  expect(world.reporter.startedTargets).toEqual([]);
  expect(await world.rows()).toEqual([]);
});

test('a repository the installation never had is not found either', async () => {
  const world = await evaluateWorld();
  expect(await world.run({ ...JOB, githubRepoId: parseGithubId(123_456) })).toEqual({
    outcome: 'skipped:repository_not_found',
  });
  expect(world.calls()).toEqual([]);
});

test('an installation nobody stored ends the job as skipped: installation_not_found, with no GitHub call', async () => {
  const world = await evaluateWorld();
  expect(await world.run({ ...JOB, githubInstallationId: parseGithubId(999_999) })).toEqual({
    outcome: 'skipped:installation_not_found',
  });
  expect(world.calls()).toEqual([]);
});

const NOT_EVALUATED = [
  ['installation_rejected', "update installations set admission_status = 'rejected'"],
  ['installation_deleted', 'update installations set deleted_at = now()'],
  ['installation_suspended', 'update installations set suspended_at = now()'],
  ['repository_removed', 'update repositories set removed_at = now()'],
  ['repository_disabled', 'update repositories set enabled = false'],
] as const;

test.each(NOT_EVALUATED)(
  'a tenant that is %s ends the job as skipped, logs the reason and makes no GitHub call',
  async (reason, statement) => {
    const world = await evaluateWorld();
    await sql.raw(statement).execute(world.raw);
    expect(await world.run()).toEqual({ outcome: `skipped:${reason}` });
    expect(world.calls()).toEqual([]);
    expect(world.reporter.startedTargets).toEqual([]);
    expect(await world.rows()).toEqual([]);
    expect(world.logs.lines()).toContainEqual(expect.objectContaining({ msg: 'evaluate_pr.skipped', reason }));
  },
);

test('a repository GitHub no longer shows the installation ends the job as skipped: repository_gone, and the snapshot marks it removed', async () => {
  const world = await evaluateWorld();
  world.fake.setRepositories(INSTALLATION, []);
  expect(await world.run()).toEqual({ outcome: 'skipped:repository_gone' });
  const stored = await world.raw.selectFrom('repositories').select('removed_at').executeTakeFirstOrThrow();
  expect(stored.removed_at).toBeInstanceOf(Date);
  expect(world.calls()).toEqual(['getRepositoryById', 'getRepositoryById']);
  expect(await world.rows()).toEqual([]);
});

test('a repository that was renamed is stored under its new name before the pull request is read, and the rest of the job uses the new name', async () => {
  const world = await evaluateWorld();
  const renamed = 'org-1/renamed';
  world.fake.setRepositories(INSTALLATION, [{ id: REPOSITORY, fullName: renamed }]);
  world.fake.addPullRequest(INSTALLATION, renamed, pullRequest(PR_NUMBER));
  world.fake.setPullRequestCommits(INSTALLATION, renamed, PR_NUMBER, defaultCommits());
  expect(await world.run()).toEqual({ outcome: 'evaluated' });
  const stored = await world.raw.selectFrom('repositories').select('full_name').executeTakeFirstOrThrow();
  expect(stored.full_name).toBe(renamed);
  expect(world.calls().slice(0, 3)).toEqual(['getRepositoryById', 'getRepositoryById', 'getPullRequest']);
  expect(world.reporter.startedTargets[0]?.fullName).toBe(renamed);
});

test('a GitHub that no longer has the pull request ends the job as skipped: pull_request_not_found, and one that closed it as pull_request_closed', async () => {
  const world = await evaluateWorld();
  expect(await world.run({ ...JOB, prNumber: 99 })).toEqual({ outcome: 'skipped:pull_request_not_found' });
  world.fake.addPullRequest(INSTALLATION, FULL_NAME, pullRequest(PR_NUMBER, { state: 'closed' }));
  expect(await world.run()).toEqual({ outcome: 'skipped:pull_request_closed' });
  expect(world.reporter.startedTargets).toEqual([]);
  expect(await world.rows()).toEqual([]);
  expect(world.evaluate).not.toHaveBeenCalled();
});

test('the helpers that read what the engine got and what the reporter published say so when there is nothing to read', async () => {
  const world = await evaluateWorld();
  await world.run({ ...JOB, githubRepoId: parseGithubId(123_456) });
  expect(() => engineInput(world)).toThrow('the engine was not run');
  expect(() => reported(world)).toThrow('nothing was published');
});
