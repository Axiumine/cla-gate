// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { asRuntimeRole, seedTenant } from '../../adapters/db/test-support.ts';
import { createLogger } from '../../adapters/http/logger.ts';
import { commitSha } from '../github-pull-contract/test-support.ts';
import { closePr } from './close-pr.ts';
import {
  CLOSE_JOB,
  type CloseWorld,
  closeWorld,
  HEAD,
  INSTALLATION,
  PR_NUMBER,
  resultsOf,
  seedEvaluation,
} from './test-support.ts';

// Tenancy (E07-S06): the close of one installation reads, cancels and reports nothing of another. Tenant 2 is the neighbour,
// with a pull request of the same number at the same head SHA, in progress.

/** Tenant 2, and the rows it has in progress: pull request 7 at the head SHA of tenant 1, and pull request 8 at another. */
async function neighbour(world: CloseWorld) {
  const other = await seedTenant(world.raw, 2);
  const stored = await world.raw
    .selectFrom('repositories')
    .select('github_repo_id')
    .where('installation_id', '=', other.installationId)
    .executeTakeFirstOrThrow();
  await world.raw
    .insertInto('pr_evaluations')
    .values(
      [
        { prNumber: PR_NUMBER, headSha: HEAD },
        { prNumber: 8, headSha: commitSha(3) },
      ].map(({ prNumber, headSha }) => ({
        installation_id: other.installationId,
        repository_id: other.repositoryId,
        pr_number: prNumber,
        head_sha: headSha,
        result: 'in_progress' as const,
      })),
    )
    .execute();
  return { other, githubRepoId: parseGithubId(stored.github_repo_id) };
}

const resultsOfTenant = async (world: CloseWorld, installationId: number) =>
  (
    await world.raw
      .selectFrom('pr_evaluations')
      .select(['pr_number', 'head_sha', 'result'])
      .where('installation_id', '=', installationId)
      .orderBy('id')
      .execute()
  ).map((row) => [row.pr_number, row.head_sha, row.result]);

test('a close for an installation with the repository id of another installation cancels nothing of the other: no GitHub call, no queue call, no report', async () => {
  const world = await closeWorld();
  const { other, githubRepoId } = await neighbour(world);
  expect(await world.runClose({ ...CLOSE_JOB, githubRepoId })).toEqual({ outcome: 'skipped:repository_not_found' });
  expect(world.calls()).toEqual([]);
  expect(world.pending.targets).toEqual([]);
  expect(world.reporter.cancellations).toEqual([]);
  expect(await resultsOfTenant(world, other.installationId)).toEqual([
    [PR_NUMBER, HEAD, 'in_progress'],
    [8, commitSha(3), 'in_progress'],
  ]);
});

test('a close for the installation that owns the repository cancels its rows only, whatever the other has at the same pull request and head SHA', async () => {
  const world = await closeWorld();
  const { other } = await neighbour(world);
  await seedEvaluation(world, { result: 'in_progress' });
  await world.runClose();
  expect(await resultsOfTenant(world, world.tenant.installationId)).toEqual([[PR_NUMBER, HEAD, 'cancelled']]);
  expect(await resultsOfTenant(world, other.installationId)).toEqual([
    [PR_NUMBER, HEAD, 'in_progress'],
    [8, commitSha(3), 'in_progress'],
  ]);
  expect(world.reporter.cancellations).toHaveLength(1);
  expect(world.pending.targets.map((target) => [target.githubInstallationId, target.githubRepoId])).toEqual([
    [INSTALLATION, CLOSE_JOB.githubRepoId],
  ]);
});

test('closing pull request 7 of tenant 1 leaves pull request 7 of tenant 2, the same number at the same head SHA in another repository, open (E15-S01)', async () => {
  const world = await closeWorld();
  const { other } = await neighbour(world);
  await seedEvaluation(world, { result: 'success' });
  await world.runClose();
  const states = (installationId: number) =>
    world.raw
      .selectFrom('pr_evaluations')
      .select(['pr_number', 'pr_state'])
      .where('installation_id', '=', installationId)
      .orderBy('id')
      .execute();
  expect(await states(world.tenant.installationId)).toEqual([{ pr_number: PR_NUMBER, pr_state: 'closed' }]);
  expect(await states(other.installationId)).toEqual([
    { pr_number: PR_NUMBER, pr_state: 'open' },
    { pr_number: 8, pr_state: 'open' },
  ]);
});

test('the rows of another repository are not mistaken for another pull request of this one: a head SHA they share does not hide the job of this pull request', async () => {
  const world = await closeWorld();
  await neighbour(world);
  await seedEvaluation(world, { result: 'in_progress', headSha: commitSha(3) });
  await world.runClose();
  expect(world.pending.targets.map((target) => target.headShas)).toEqual([[commitSha(3), HEAD]]);
});

test('the job runs as the runtime role: it can read the rows and set the result of the one in progress', async () => {
  const world = await closeWorld({ runtime: true });
  await seedEvaluation(world, { result: 'in_progress' });
  const logger = createLogger({ logLevel: 'info' }, world.logs.destination);
  const outcome = await asRuntimeRole(world.raw, (trx) =>
    closePr({ ...world.ports, db: trx }, CLOSE_JOB, { logger, pending: world.pending }),
  );
  expect(outcome).toEqual({ outcome: 'closed' });
  expect(await resultsOf(world)).toEqual([[PR_NUMBER, HEAD, 'cancelled']]);
});
