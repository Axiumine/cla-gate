// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { GitHubRateLimitedError } from '../ports/github-errors.ts';
import { sweepPolicyChange } from './policy-sweep.ts';
import { addNeighbour, INSTALLATION, POLICY_JOB, REPOSITORY, type SweepWorld, sweepWorld } from './test-support.ts';

// What the `sweep-repository` job leaves alone and what it does when GitHub fails (E07-S09): an installation or repository that
// is not evaluated ends the job before any GitHub call, the ids of a payload are keys read under the installation, and a
// failure is the queue's to retry.

test('a repository with enforcement off ends the job as skipped, with no GitHub call and nothing sent', async () => {
  const world = await sweepWorld();
  await world.raw.updateTable('repositories').set({ enabled: false }).execute();
  expect(await world.runPolicySweep()).toEqual({ outcome: 'skipped:repository_disabled' });
  expect(world.fake.calls).toEqual([]);
  expect(await world.queued()).toEqual([]);
});

test('a repository GitHub no longer lists for the installation ends the job as skipped, with no GitHub call and nothing sent', async () => {
  const world = await sweepWorld();
  await world.raw
    .updateTable('repositories')
    .set({ removed_at: new Date('2026-11-01T09:30:00Z') })
    .execute();
  expect(await world.runPolicySweep()).toEqual({ outcome: 'skipped:repository_removed' });
  expect(world.fake.calls).toEqual([]);
  expect(await world.queued()).toEqual([]);
});

test.each([
  ['rejected', { admission: 'rejected' }, 'skipped:installation_rejected'],
  ['suspended', { suspended: true }, 'skipped:installation_suspended'],
  ['deleted', { deleted: true }, 'skipped:installation_deleted'],
] as const)(
  'an installation that is %s ends the job as skipped with no GitHub call, while the admitted one is swept',
  async (_state, state, outcome) => {
    const world = await sweepWorld();
    const neighbour = await addNeighbour(world, 2, state);
    expect(
      await world.runPolicySweep({
        type: 'sweep-repository',
        githubInstallationId: neighbour.githubInstallationId,
        githubRepoId: neighbour.githubRepoId,
        reason: 'cla_document_changed',
      }),
    ).toEqual({ outcome });
    expect(world.fake.calls).toEqual([]);
    expect(await world.queued()).toEqual([]);
    expect(await world.runPolicySweep()).toEqual({ outcome: 'swept' });
    expect(world.fake.calls.every((call) => call.installationId === INSTALLATION)).toBe(true);
    expect(await world.queuedPulls()).toEqual([7]);
  },
);

test('an installation the database does not know ends the job as skipped with no GitHub call', async () => {
  const world = await sweepWorld();
  expect(await world.runPolicySweep({ ...POLICY_JOB, githubInstallationId: parseGithubId(424_242) })).toEqual({
    outcome: 'skipped:installation_not_found',
  });
  expect(world.fake.calls).toEqual([]);
});

test('a payload that names installation A and a repository of installation B enqueues nothing and asks GitHub nothing, in both directions', async () => {
  const world = await sweepWorld();
  const neighbour = await addNeighbour(world, 2);
  const aWithB = { ...POLICY_JOB, githubRepoId: neighbour.githubRepoId };
  const bWithA = {
    ...POLICY_JOB,
    githubInstallationId: neighbour.githubInstallationId,
    githubRepoId: REPOSITORY,
  };
  expect(await world.runPolicySweep(aWithB)).toEqual({ outcome: 'skipped:repository_not_found' });
  expect(await world.runPolicySweep(bWithA)).toEqual({ outcome: 'skipped:repository_not_found' });
  expect(world.fake.calls).toEqual([]);
  expect(await world.queued()).toEqual([]);
  expect(world.enqueuer.calls).toEqual([]);
});

test('the pull requests of installation B never reach the queue of a job of installation A', async () => {
  const world = await sweepWorld();
  const neighbour = await addNeighbour(world, 2);
  await world.runPolicySweep();
  expect((await world.queued()).map(({ job }) => job)).toEqual([
    expect.objectContaining({ githubInstallationId: INSTALLATION, githubRepoId: REPOSITORY, prNumber: 7 }),
  ]);
  expect(world.fake.calls.some((call) => call.installationId === neighbour.githubInstallationId)).toBe(false);
});

test('a repository GitHub no longer shows ends the job as skipped, marked removed by the snapshot refresh, with no listing', async () => {
  const world = await sweepWorld();
  world.fake.setRepositories(INSTALLATION, []);
  expect(await world.runPolicySweep()).toEqual({ outcome: 'skipped:repository_gone' });
  expect(world.calls()).toEqual(['getRepositoryById', 'getRepositoryById']);
  expect(await world.queued()).toEqual([]);
  expect(
    (await world.raw.selectFrom('repositories').select('removed_at').execute()).map((row) => row.removed_at !== null),
  ).toEqual([true]);
});

test('a rate limit ends the job with the rate limit, so the queue retries it later, and nothing was sent', async () => {
  const world = await sweepWorld();
  const limit = new GitHubRateLimitedError(3600, 'primary');
  world.fake.failNext('listOpenPullRequests', limit);
  await expect(world.runPolicySweep()).rejects.toBe(limit);
  expect(await world.queued()).toEqual([]);
});

test('any other failure of GitHub fails the job too, and a pull request listed before it is not sent half way', async () => {
  const world = await sweepWorld();
  world.fake.failNext('listOpenPullRequests', new Error('GitHub answered 502'));
  await expect(world.runPolicySweep()).rejects.toThrow('GitHub answered 502');
  expect(await world.queued()).toEqual([]);
});

test('an installation GitHub or the gate stops serving while the job runs ends the job as skipped, with nothing sent', async () => {
  const world = await sweepWorld();
  world.gate.refuse(INSTALLATION, 'suspended');
  expect(await world.runPolicySweep()).toEqual({ outcome: 'skipped:installation_unavailable' });
  expect(await world.queued()).toEqual([]);
});

test('a queue that fails while the evaluations are sent fails the job and keeps none of them: the sends are one transaction', async () => {
  const world = await sweepWorld();
  const failure = new Error('connection lost');
  const context = world.context('policy-1');
  const failing = {
    ...context,
    enqueuer: {
      enqueue: async (...args: Parameters<typeof context.enqueuer.enqueue>) => {
        await context.enqueuer.enqueue(...args);
        throw failure;
      },
    },
  };
  await expect(sweepPolicyChange(world.evaluatePorts, POLICY_JOB, failing)).rejects.toBe(failure);
  expect(await world.queued()).toEqual([]);
});

// The log line of a skipped job (E07-S09): one line at info level, with the reason that is also the end of the outcome and nothing
// of the job (no id of an installation or of a repository, no pull request): the operator reads why a job did nothing.
const skippedLines = (world: SweepWorld) =>
  world.logs.lines().filter((line) => line['msg'] === 'sweep_repository.skipped');

test.each([
  [
    'a repository with enforcement off',
    'repository_disabled',
    (world: SweepWorld) => world.raw.updateTable('repositories').set({ enabled: false }).execute(),
  ],
  [
    'a repository GitHub no longer lists for the installation',
    'repository_removed',
    (world: SweepWorld) =>
      world.raw
        .updateTable('repositories')
        .set({ removed_at: new Date('2026-11-01T09:30:00Z') })
        .execute(),
  ],
  [
    'a repository GitHub no longer shows',
    'repository_gone',
    (world: SweepWorld) => {
      world.fake.setRepositories(INSTALLATION, []);
      return Promise.resolve();
    },
  ],
] as const)(
  '%s is logged once as skipped, with its reason and nothing else of the job',
  async (_name, reason, prepare) => {
    const world = await sweepWorld();
    await prepare(world);
    expect(await world.runPolicySweep()).toEqual({ outcome: `skipped:${reason}` });
    const lines = skippedLines(world);
    expect(lines).toHaveLength(1);
    const { time, pid, hostname, ...fields } = lines[0] ?? {};
    expect([typeof time, typeof pid, typeof hostname]).toEqual(['string', 'number', 'string']);
    expect(fields).toEqual({ level: 30, reason, msg: 'sweep_repository.skipped' });
    expect(world.logs.lines().filter((each) => each['msg'] === 'sweep_repository.swept')).toEqual([]);
  },
);

test('a job that is swept logs no skipped line', async () => {
  const world = await sweepWorld();
  expect(await world.runPolicySweep()).toEqual({ outcome: 'swept' });
  expect(skippedLines(world)).toEqual([]);
});
