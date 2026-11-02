// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { seedTenant } from '../../adapters/db/test-support.ts';
import { INSTALLATION, JOB, PR_NUMBER, REPOSITORY } from '../evaluate-pr/test-support.ts';
import { commitSha } from '../github-pull-contract/test-support.ts';
import { type DeadWorld, deadWorld } from './test-support.ts';

// Tenancy (E07-S05): the dead-letter handler of one installation reads and writes nothing of another. Tenant 2 is the
// neighbour: it has an evaluation of its own at the same pull request number and head SHA as tenant 1.

/** Tenant 2, with an evaluation in progress of pull request 7 at `commitSha(2)`, the same as tenant 1's. */
async function neighbour(world: DeadWorld) {
  const other = await seedTenant(world.raw, 2);
  await world.raw
    .insertInto('pr_evaluations')
    .values({
      installation_id: other.installationId,
      repository_id: other.repositoryId,
      pr_number: PR_NUMBER,
      head_sha: commitSha(2),
      result: 'in_progress',
      details: '{}',
    })
    .execute();
  const repository = await world.raw
    .selectFrom('repositories')
    .select('github_repo_id')
    .where('installation_id', '=', other.installationId)
    .executeTakeFirstOrThrow();
  return { ...other, githubRepoId: parseGithubId(repository.github_repo_id) };
}

const stored = (world: DeadWorld) =>
  world.raw
    .selectFrom('pr_evaluations')
    .select(['installation_id', 'pr_number', 'head_sha', 'result', 'details'])
    .orderBy('id')
    .execute();

test('a dead evaluate-pr naming installation A and a repository of B reads, writes and reports nothing of B', async () => {
  const world = await deadWorld();
  const other = await neighbour(world);
  const before = await stored(world);
  expect(await world.runDead({ ...JOB, githubRepoId: other.githubRepoId })).toEqual({
    outcome: 'skipped:repository_not_found',
  });
  expect(world.calls()).toEqual([]);
  expect(world.reporter.failures).toEqual([]);
  expect(await stored(world)).toEqual(before);
});

test('a dead evaluate-head-sha naming installation A and a repository of B does the same', async () => {
  const world = await deadWorld();
  const other = await neighbour(world);
  const before = await stored(world);
  const job = {
    type: 'evaluate-head-sha',
    githubInstallationId: INSTALLATION,
    githubRepoId: other.githubRepoId,
    headSha: commitSha(2),
  };
  expect(await world.runDead(job)).toEqual({ outcome: 'skipped:repository_not_found' });
  expect(world.calls()).toEqual([]);
  expect(await stored(world)).toEqual(before);
});

test('the failure of tenant A at a head SHA that tenant B also has leaves the evaluation of B as it was', async () => {
  const world = await deadWorld();
  const other = await neighbour(world);
  await world.runDead(JOB);
  expect(await stored(world)).toEqual([
    {
      installation_id: other.installationId,
      pr_number: PR_NUMBER,
      head_sha: commitSha(2),
      result: 'in_progress',
      details: {},
    },
    {
      installation_id: world.tenant.installationId,
      pr_number: PR_NUMBER,
      head_sha: commitSha(2),
      result: 'failure',
      details: { code: 'evaluation_failed' },
    },
  ]);
  expect(world.reporter.failures.map((failure) => failure.target.githubRepoId)).toEqual([REPOSITORY]);
});

test('a dead evaluate-head-sha of tenant A fails the evaluations of A at the SHA and not those of B', async () => {
  const world = await deadWorld();
  const other = await neighbour(world);
  await world.raw
    .insertInto('pr_evaluations')
    .values({
      installation_id: world.tenant.installationId,
      repository_id: world.tenant.repositoryId,
      pr_number: PR_NUMBER,
      head_sha: commitSha(2),
      result: 'in_progress',
      details: '{}',
    })
    .execute();
  await world.runDead({
    type: 'evaluate-head-sha',
    githubInstallationId: INSTALLATION,
    githubRepoId: REPOSITORY,
    headSha: commitSha(2),
  });
  expect((await stored(world)).map((row) => [row.installation_id, row.result])).toEqual([
    [other.installationId, 'in_progress'],
    [world.tenant.installationId, 'failure'],
  ]);
  expect(world.reporter.failures).toHaveLength(1);
});
