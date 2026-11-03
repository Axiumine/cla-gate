// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { CLOSE_JOB, closeWorld, HEAD, INSTALLATION, PR_NUMBER, resultsOf, seedEvaluation } from './test-support.ts';

// The job ends without touching anything (E07-S06): the stored tenant decides whether the pull request is looked at at all,
// and GitHub decides whether the installation is still served.

const NOT_EVALUATED = [
  ['installation_rejected', "update installations set admission_status = 'rejected'"],
  ['installation_deleted', 'update installations set deleted_at = now()'],
  ['installation_suspended', 'update installations set suspended_at = now()'],
  ['repository_removed', 'update repositories set removed_at = now()'],
  ['repository_disabled', 'update repositories set enabled = false'],
] as const;

test.each(NOT_EVALUATED)(
  'a tenant that is %s ends the job as skipped, logs the reason and makes no GitHub call, no queue call and no report',
  async (reason, statement) => {
    const world = await closeWorld();
    await seedEvaluation(world, { result: 'in_progress' });
    await sql.raw(statement).execute(world.raw);
    expect(await world.runClose()).toEqual({ outcome: `skipped:${reason}` });
    expect(world.calls()).toEqual([]);
    expect(world.pending.targets).toEqual([]);
    expect(world.reporter.cancellations).toEqual([]);
    expect(await resultsOf(world)).toEqual([[PR_NUMBER, HEAD, 'in_progress']]);
    expect(world.logs.lines()).toContainEqual(expect.objectContaining({ msg: 'close_pr.skipped', reason }));
  },
);

test('an installation nobody stored, and a repository the installation never had, end the job as skipped with no GitHub call', async () => {
  const world = await closeWorld();
  expect(await world.runClose({ ...CLOSE_JOB, githubInstallationId: parseGithubId(999_999) })).toEqual({
    outcome: 'skipped:installation_not_found',
  });
  expect(await world.runClose({ ...CLOSE_JOB, githubRepoId: parseGithubId(123_456) })).toEqual({
    outcome: 'skipped:repository_not_found',
  });
  expect(world.calls()).toEqual([]);
});

test('a repository GitHub no longer shows the installation ends the job as skipped: repository_gone, and the rows stay as they are', async () => {
  const world = await closeWorld();
  await seedEvaluation(world, { result: 'in_progress' });
  world.fake.setRepositories(INSTALLATION, []);
  expect(await world.runClose()).toEqual({ outcome: 'skipped:repository_gone' });
  expect(world.pending.targets).toEqual([]);
  expect(await resultsOf(world)).toEqual([[PR_NUMBER, HEAD, 'in_progress']]);
});

test.each([
  [
    'GitHub no longer has it',
    (world: Awaited<ReturnType<typeof closeWorld>>) => {
      world.fake.removeInstallation(INSTALLATION);
    },
  ],
  [
    'it is suspended',
    (world: Awaited<ReturnType<typeof closeWorld>>) => {
      world.fake.suspend(INSTALLATION, new Date('2026-11-01T00:00:00Z'));
    },
  ],
  [
    'the gate refuses it',
    (world: Awaited<ReturnType<typeof closeWorld>>) => {
      world.gate.refuse(INSTALLATION, 'rejected');
    },
  ],
])('an installation that cannot be served (%s) ends the job as skipped, without a retry', async (_why, apply) => {
  const world = await closeWorld();
  await seedEvaluation(world, { result: 'in_progress' });
  apply(world);
  expect(await world.runClose()).toEqual({ outcome: 'skipped:installation_unavailable' });
  expect(world.pending.targets).toEqual([]);
  expect(await resultsOf(world)).toEqual([[PR_NUMBER, HEAD, 'in_progress']]);
});
