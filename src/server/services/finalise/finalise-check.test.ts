// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test, vi } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { evaluationCoalesceKey } from '../../domain/sweep.ts';
import { commitSha, pullRequest } from '../github-pull-contract/test-support.ts';
import { GitHubRateLimitedError } from '../ports/github-errors.ts';
import {
  CHECK_JOB,
  FULL_NAME,
  finaliseWorld,
  HEAD,
  INSTALLATION,
  NOT_FINALISED,
  PR_NUMBER,
  REPOSITORY,
  seedEvaluation,
} from './test-support.ts';

// The `finalise-check` job (E14-S04): the check of an open pull request of a repository whose enforcement was turned off is
// completed `neutral` through the reporter, whatever its evaluation says, and nothing else is written.

test('an open pull request gets its check completed through the reporter, for the head SHA GitHub shows and the row of that head SHA', async () => {
  const world = await finaliseWorld();
  const row = await seedEvaluation(world, { result: 'failure' });
  expect(await world.runCheck()).toEqual({ outcome: 'finalised' });
  expect(world.reporter.disabled).toEqual([
    {
      githubInstallationId: INSTALLATION,
      githubRepoId: REPOSITORY,
      fullName: FULL_NAME,
      prNumber: PR_NUMBER,
      headSha: HEAD,
      evaluationId: row,
    },
  ]);
  expect(world.reporter.startedTargets).toEqual([]);
  expect(world.reporter.published).toEqual([]);
  expect(world.reporter.failures).toEqual([]);
  expect(world.reporter.cancellations).toEqual([]);
});

test.each(['in_progress', 'failure', 'success', 'cancelled'] as const)(
  'a %s row is no condition of the report and is left as it is, because neutral exists on GitHub only',
  async (result) => {
    const world = await finaliseWorld();
    await seedEvaluation(world, { result });
    const before = await world.rows();
    expect(await world.runCheck()).toEqual({ outcome: 'finalised' });
    expect(await world.rows()).toEqual(before);
    expect(world.reporter.disabled).toHaveLength(1);
  },
);

test('the job reads the pull request now: the report is for the head SHA GitHub shows, with the row of that head SHA', async () => {
  const world = await finaliseWorld();
  const older = await seedEvaluation(world, { result: 'failure', headSha: commitSha(9) });
  const current = await seedEvaluation(world, { result: 'in_progress' });
  expect(older).not.toBe(current);
  await world.runCheck();
  expect(world.reporter.disabled.map((target) => [target.headSha, target.evaluationId])).toEqual([[HEAD, current]]);
});

test('a head SHA the platform never evaluated has no check of its own to complete: skipped no_evaluation, nothing is reported', async () => {
  const world = await finaliseWorld();
  await seedEvaluation(world, { result: 'failure', headSha: commitSha(9) });
  expect(await world.runCheck()).toEqual({ outcome: 'skipped:no_evaluation' });
  expect(world.reporter.disabled).toEqual([]);
  expect(world.logs.lines()).toContainEqual(
    expect.objectContaining({ msg: 'finalise_check.skipped', reason: 'no_evaluation' }),
  );
});

test('a pull request GitHub does not have is skipped, and so is a closed one: no report', async () => {
  const world = await finaliseWorld();
  await seedEvaluation(world, { result: 'in_progress' });
  expect(await world.runCheck({ ...CHECK_JOB, prNumber: 99 })).toEqual({ outcome: 'skipped:pull_request_not_found' });
  world.fake.addPullRequest(INSTALLATION, FULL_NAME, pullRequest(PR_NUMBER, { state: 'closed' }));
  expect(await world.runCheck()).toEqual({ outcome: 'skipped:pull_request_closed' });
  expect(world.reporter.disabled).toEqual([]);
});

test('a repository that was renamed is stored under its new name, and the report is made under it', async () => {
  const world = await finaliseWorld();
  const renamed = 'org-1/renamed';
  world.fake.setRepositories(INSTALLATION, [{ id: REPOSITORY, fullName: renamed }]);
  world.fake.addPullRequest(INSTALLATION, renamed, pullRequest(PR_NUMBER));
  await seedEvaluation(world, { result: 'failure' });
  expect(await world.runCheck()).toEqual({ outcome: 'finalised' });
  expect(world.reporter.disabled[0]?.fullName).toBe(renamed);
  const stored = await world.raw.selectFrom('repositories').select('full_name').executeTakeFirstOrThrow();
  expect(stored.full_name).toBe(renamed);
});

test('a repository GitHub no longer shows the installation ends the job as skipped: repository_gone, nothing is reported', async () => {
  const world = await finaliseWorld();
  await seedEvaluation(world, { result: 'in_progress' });
  world.fake.setRepositories(INSTALLATION, []);
  expect(await world.runCheck()).toEqual({ outcome: 'skipped:repository_gone' });
  expect(world.reporter.disabled).toEqual([]);
});

test.each(NOT_FINALISED)(
  'a tenant that is %s ends the job as skipped, logs the reason and makes no GitHub call, no queue call and no report',
  async (reason, statement) => {
    const world = await finaliseWorld();
    await seedEvaluation(world, { result: 'in_progress' });
    await sql.raw(statement).execute(world.raw);
    expect(await world.runCheck()).toEqual({ outcome: `skipped:${reason}` });
    expect(world.calls()).toEqual([]);
    expect(world.reporter.disabled).toEqual([]);
    expect(await world.sent()).toEqual([]);
    expect(world.logs.lines()).toContainEqual(expect.objectContaining({ msg: 'finalise_check.skipped', reason }));
  },
);

test('an installation nobody stored, and a repository the installation never had, end the job as skipped with no GitHub call', async () => {
  const world = await finaliseWorld();
  const unknownInstallation = { ...CHECK_JOB, githubInstallationId: parseGithubId(999_999) };
  expect(await world.runCheck(unknownInstallation)).toEqual({ outcome: 'skipped:installation_not_found' });
  expect(await world.runCheck({ ...CHECK_JOB, githubRepoId: parseGithubId(123_456) })).toEqual({
    outcome: 'skipped:repository_not_found',
  });
  expect(world.calls()).toEqual([]);
});

test.each([
  [
    'GitHub no longer has it',
    (world: Awaited<ReturnType<typeof finaliseWorld>>) => {
      world.fake.removeInstallation(INSTALLATION);
    },
  ],
  [
    'it is suspended',
    (world: Awaited<ReturnType<typeof finaliseWorld>>) => {
      world.fake.suspend(INSTALLATION, new Date('2026-11-01T00:00:00Z'));
    },
  ],
  [
    'the gate refuses it',
    (world: Awaited<ReturnType<typeof finaliseWorld>>) => {
      world.gate.refuse(INSTALLATION, 'rejected');
    },
  ],
])('an installation that cannot be served (%s) ends the job as skipped, without a retry', async (_why, apply) => {
  const world = await finaliseWorld();
  await seedEvaluation(world, { result: 'in_progress' });
  apply(world);
  expect(await world.runCheck()).toEqual({ outcome: 'skipped:installation_unavailable' });
  expect(world.reporter.disabled).toEqual([]);
});

test('a reporter that skips the report ends the job as skipped with its reason', async () => {
  const world = await finaliseWorld();
  await seedEvaluation(world, { result: 'failure' });
  vi.spyOn(world.reporter, 'enforcementDisabled').mockResolvedValue({ status: 'skipped', reason: 'repository_gone' });
  expect(await world.runCheck()).toEqual({ outcome: 'skipped:repository_gone' });
  expect(world.logs.lines()).toContainEqual(
    expect.objectContaining({ msg: 'finalise_check.skipped', reason: 'repository_gone' }),
  );
});

test('a failure of the reporter and a rate limit fail the job as they are: the queue retries, and the report is idempotent', async () => {
  const world = await finaliseWorld();
  await seedEvaluation(world, { result: 'failure' });
  world.reporter.hooks.enforcementDisabled = () => Promise.reject(new Error('the reporter is down'));
  await expect(world.runCheck()).rejects.toThrow('the reporter is down');
  world.reporter.hooks.enforcementDisabled = undefined;
  const limited = new GitHubRateLimitedError(30, 'primary');
  world.fake.failNext('getPullRequest', limited);
  await expect(world.runCheck()).rejects.toBe(limited);
  expect(await world.runCheck()).toEqual({ outcome: 'finalised' });
});

test('a repository turned on again while the report was written is evaluated once more, under a key of this job, coalesced per pull request', async () => {
  const world = await finaliseWorld();
  await seedEvaluation(world, { result: 'failure' });
  world.reporter.hooks.enforcementDisabled = async () => {
    await world.raw.updateTable('repositories').set({ enabled: true }).execute();
  };
  expect(await world.runCheck(undefined, 'job-7')).toEqual({ outcome: 'finalised' });
  expect(await world.sent()).toEqual([
    {
      idempotencyKey: `finalise-check-reevaluation:job-7:${String(REPOSITORY)}:${String(PR_NUMBER)}`,
      dedupeKey: null,
      coalesceKey: evaluationCoalesceKey(REPOSITORY, PR_NUMBER),
      job: {
        type: 'evaluate-pr',
        githubInstallationId: INSTALLATION,
        githubRepoId: REPOSITORY,
        prNumber: PR_NUMBER,
        trigger: 'policy_change',
      },
    },
  ]);
});

test('a repository that stays off sends nothing from the job', async () => {
  const world = await finaliseWorld();
  await seedEvaluation(world, { result: 'failure' });
  await world.runCheck();
  expect(await world.sent()).toEqual([]);
});
