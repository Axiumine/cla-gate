// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { seedTenant } from '../../adapters/db/test-support.ts';
import { pullRef } from '../github-comment-contract/test-support.ts';
import { jobCount } from '../jobs-fixture/test-support.ts';
import {
  COMMENT_JOB,
  FULL_NAME,
  HEAD,
  HEAD_JOB,
  INSTALLATION,
  type RecheckWorld,
  recheckWorld,
} from './test-support.ts';

// Tenancy (E07-S07): a re-evaluation asked for in one installation reads and sends nothing of another. Tenant 2 is the
// neighbour, with a repository whose id the hostile jobs below name under the installation of tenant 1.

async function neighbourRepository(world: RecheckWorld) {
  const other = await seedTenant(world.raw, 2);
  const stored = await world.raw
    .selectFrom('repositories')
    .select('github_repo_id')
    .where('installation_id', '=', other.installationId)
    .executeTakeFirstOrThrow();
  return parseGithubId(stored.github_repo_id);
}

test('a /recheck for an installation with the repository id of another sends nothing and asks GitHub nothing', async () => {
  const world = await recheckWorld();
  const githubRepoId = await neighbourRepository(world);
  expect(await world.runComment({ ...COMMENT_JOB, githubRepoId })).toEqual({ outcome: 'skipped:repository_not_found' });
  expect(world.calls()).toEqual([]);
  expect(world.enqueuer.calls).toEqual([]);
  expect(await jobCount(world.raw)).toBe(0);
});

test('a Re-run for an installation with the repository id of another sends nothing and asks GitHub nothing', async () => {
  const world = await recheckWorld();
  const githubRepoId = await neighbourRepository(world);
  world.fake.setCommitPullRequests(INSTALLATION, FULL_NAME, HEAD, [pullRef(7)]);
  expect(await world.runHead({ ...HEAD_JOB, githubRepoId })).toEqual({ outcome: 'skipped:repository_not_found' });
  expect(world.calls()).toEqual([]);
  expect(await jobCount(world.raw)).toBe(0);
});

test('every GitHub call a re-evaluation makes is made for the installation of the job', async () => {
  const world = await recheckWorld();
  world.fake.setCommitPullRequests(INSTALLATION, FULL_NAME, HEAD, [pullRef(7)]);
  await world.runComment();
  await world.runHead();
  expect(new Set(world.fake.calls.map((call) => call.installationId))).toEqual(new Set([INSTALLATION]));
});

test('the evaluations sent carry the installation and repository of the job, so a worker keys on them and on nothing the comment said', async () => {
  const world = await recheckWorld();
  await world.runComment();
  const [sent] = await world.queued();
  expect(sent?.job).toMatchObject({ githubInstallationId: INSTALLATION, githubRepoId: COMMENT_JOB.githubRepoId });
  expect(Object.keys(sent?.job ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual([
    'githubInstallationId',
    'githubRepoId',
    'prNumber',
    'trigger',
    'type',
  ]);
});
