// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { commitSha, pullRequest } from '../github-pull-contract/test-support.ts';
import type { JobOutcome } from '../job-registry.ts';
import {
  addNeighbour,
  callsFor,
  FULL_NAME,
  HEAD,
  INSTALLATION,
  MINUTE,
  NEWER_HEAD,
  openPull,
  REPOSITORY,
  SWEEP_JOB,
  seedAged,
  sweepWorld,
} from './test-support.ts';

// What the sweep of an installation asks to be evaluated (E07-S08): the open pull requests that have no final result for their
// head SHA, and no other. The world has one repository with open pull request 7 at `HEAD`.

test.each([
  ['no row at all', undefined, true],
  ['a success for the head SHA', { result: 'success' }, false],
  ['a failure for the head SHA', { result: 'failure' }, false],
  ['a cancelled evaluation for the head SHA', { result: 'cancelled' }, true],
  ['an evaluation in progress for 5 minutes', { result: 'in_progress', ageMinutes: 5 }, false],
  ['an evaluation in progress for exactly 30 minutes', { result: 'in_progress', ageMinutes: 30 }, false],
  ['an evaluation in progress for 31 minutes', { result: 'in_progress', ageMinutes: 31 }, true],
  ['an evaluation in progress for a day', { result: 'in_progress', ageMinutes: 1440 }, true],
] as const)('a pull request with %s is queued for evaluation: %s', async (_name, stored, queued) => {
  const world = await sweepWorld();
  if (stored !== undefined) {
    await seedAged(world, { prNumber: 7, headSha: HEAD, ...stored });
  }
  expect(await world.runSweep()).toEqual({ outcome: 'swept' });
  expect(await world.queuedPulls()).toEqual(queued ? [7] : []);
});

test('a result for another head SHA of the pull request is no result for the one it has now: the new commit is queued', async () => {
  const world = await sweepWorld();
  await seedAged(world, { prNumber: 7, headSha: commitSha(9), result: 'success' });
  openPull(world, 7, NEWER_HEAD);
  await world.runSweep();
  expect(await world.queuedPulls()).toEqual([7]);
});

test('a result for another pull request at the same head SHA is no result either', async () => {
  const world = await sweepWorld();
  await seedAged(world, { prNumber: 8, headSha: HEAD, result: 'success' });
  await world.runSweep();
  expect(await world.queuedPulls()).toEqual([7]);
});

test('the job sent is an evaluate-pr of the pull request with the trigger sweep, under a dedupe window of 5 minutes per pull request', async () => {
  const world = await sweepWorld();
  await world.runSweep();
  expect(world.enqueuer.calls).toEqual([
    {
      job: {
        type: 'evaluate-pr',
        githubInstallationId: INSTALLATION,
        githubRepoId: REPOSITORY,
        prNumber: 7,
        trigger: 'sweep',
      },
      options: {
        idempotencyKey: 'sweep:sweep-1:9000:7',
        dedupeKey: 'sweep:9000:7',
        dedupeWindowSeconds: 300,
      },
    },
  ]);
});

test('a pull request whose job is still queued is not queued again by the next sweep, and a sweep after the window is', async () => {
  const world = await sweepWorld();
  await world.runSweep(SWEEP_JOB, 'sweep-1');
  world.clock.advance(4 * MINUTE);
  await world.runSweep(SWEEP_JOB, 'sweep-2');
  expect(await world.queuedPulls()).toEqual([7]);
  world.clock.advance(2 * MINUTE);
  await world.runSweep(SWEEP_JOB, 'sweep-3');
  expect(await world.queuedPulls()).toEqual([7, 7]);
});

test('a retry of the same run sends nothing more: the job that is queued already will do the evaluation', async () => {
  const world = await sweepWorld();
  await world.runSweep(SWEEP_JOB, 'sweep-1');
  await world.runSweep(SWEEP_JOB, 'sweep-1');
  expect(await world.queuedPulls()).toEqual([7]);
  expect(world.logs.lines()).toContainEqual(
    expect.objectContaining({ msg: 'sweep_installation.swept', alreadyQueued: 1 }),
  );
});

test('a pull request opened with no webhook is evaluated after one sweep, exactly once, and a second sweep queues nothing for it', async () => {
  const world = await sweepWorld();
  expect(await world.rows()).toEqual([]);
  await world.runSweep(SWEEP_JOB, 'sweep-1');
  const [sent] = await world.queued();
  expect(sent?.job).toMatchObject({ type: 'evaluate-pr', prNumber: 7, trigger: 'sweep' });
  if (sent?.job.type !== 'evaluate-pr') {
    throw new Error('an evaluate-pr job was expected');
  }
  expect(await world.run(sent.job)).toEqual({ outcome: 'evaluated' });
  expect((await world.rows()).map((row) => [row.pr_number, row.head_sha, row.result])).toEqual([[7, HEAD, 'success']]);
  world.clock.advance(10 * MINUTE);
  await world.runSweep(SWEEP_JOB, 'sweep-2');
  expect(await world.queuedPulls()).toEqual([7]);
  expect(world.reporter.published).toHaveLength(1);
});

test('the pull requests of a repository are all asked for: a sweep queues the missed ones and leaves the evaluated ones', async () => {
  const world = await sweepWorld();
  for (const number of [8, 9, 10]) {
    openPull(world, number);
  }
  await seedAged(world, { prNumber: 9, headSha: HEAD, result: 'success' });
  await world.runSweep();
  expect(await world.queuedPulls()).toEqual([10, 8, 7]);
});

test('an installation with no open pull request queues nothing and costs one request', async () => {
  const world = await sweepWorld();
  world.fake.addPullRequest(INSTALLATION, FULL_NAME, pullRequest(7, { state: 'closed' }));
  expect(await world.runSweep()).toEqual({ outcome: 'swept' });
  expect(await world.queued()).toEqual([]);
  expect(world.calls()).toEqual(['listOpenPullRequests']);
});

test('an installation that is admitted, with an enabled repository, is swept with the pull requests of that repository only', async () => {
  const world = await sweepWorld();
  const rejected = await addNeighbour(world, 2, { admission: 'rejected' });
  const suspended = await addNeighbour(world, 3, { suspended: true });
  const deleted = await addNeighbour(world, 4, { deleted: true });
  const outcomes: JobOutcome[] = [];
  for (const id of [
    INSTALLATION,
    rejected.githubInstallationId,
    suspended.githubInstallationId,
    deleted.githubInstallationId,
  ]) {
    outcomes.push(await world.runSweep({ type: 'sweep-installation', githubInstallationId: id }));
  }
  expect(outcomes).toEqual([
    { outcome: 'swept' },
    { outcome: 'skipped:installation_rejected' },
    { outcome: 'skipped:installation_suspended' },
    { outcome: 'skipped:installation_deleted' },
  ]);
  expect(callsFor(world, INSTALLATION)).toBe(1);
  expect(callsFor(world, rejected.githubInstallationId)).toBe(0);
  expect(callsFor(world, suspended.githubInstallationId)).toBe(0);
  expect(callsFor(world, deleted.githubInstallationId)).toBe(0);
  expect(world.fake.calls).toEqual([{ method: 'listOpenPullRequests', installationId: INSTALLATION }]);
  expect(await world.queuedPulls()).toEqual([7]);
});

test('an installation the database does not know is skipped with no request', async () => {
  const world = await sweepWorld();
  const stranger = parseGithubId(424_242);
  expect(await world.runSweep({ type: 'sweep-installation', githubInstallationId: stranger })).toEqual({
    outcome: 'skipped:installation_not_found',
  });
  expect(world.fake.calls).toEqual([]);
  expect(await world.queued()).toEqual([]);
});

test('the sweep of one installation reads and writes nothing of another: the same pull request number and head SHA of two tenants are two pull requests', async () => {
  const world = await sweepWorld();
  const neighbour = await addNeighbour(world, 2);
  await seedAged(world, { prNumber: 7, headSha: HEAD, result: 'success' });
  await world.runSweep(SWEEP_JOB, 'sweep-1');
  expect(await world.queuedPulls()).toEqual([]);
  expect(callsFor(world, neighbour.githubInstallationId)).toBe(0);
  await world.runSweep({ type: 'sweep-installation', githubInstallationId: neighbour.githubInstallationId }, 'sweep-2');
  const [sent] = await world.queued();
  expect(sent?.job).toMatchObject({
    githubInstallationId: neighbour.githubInstallationId,
    githubRepoId: neighbour.githubRepoId,
    prNumber: 7,
  });
  expect(callsFor(world, INSTALLATION)).toBe(1);
});
