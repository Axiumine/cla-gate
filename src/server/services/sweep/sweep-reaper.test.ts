// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { resultsOf } from '../close-pr/test-support.ts';
import { pullRequest } from '../github-pull-contract/test-support.ts';
import {
  addNeighbour,
  FULL_NAME,
  HEAD,
  INSTALLATION,
  MINUTE,
  NEWER_HEAD,
  openPull,
  REPOSITORY,
  seedAged,
  sweepWorld,
} from './test-support.ts';

// The reaper (E07-S08): an evaluation `in_progress` for more than 30 minutes belongs to a job that was lost. A pull request that
// was closed is cleared the way a close clears it (E07-S06); one that is open is evaluated again under the dedupe window.

const closePull = (world: Awaited<ReturnType<typeof sweepWorld>>, number = 7): void => {
  world.fake.addPullRequest(INSTALLATION, FULL_NAME, pullRequest(number, { state: 'closed' }));
};

test('a pull request that was closed while its evaluation was lost is cleared: the Check Run is reported cancelled and the row is cancelled', async () => {
  const world = await sweepWorld();
  closePull(world);
  const id = await seedAged(world, { prNumber: 7, headSha: HEAD, result: 'in_progress', ageMinutes: 31 });
  world.pending.cancelled = 2;
  expect(await world.runSweep()).toEqual({ outcome: 'swept' });
  expect(await resultsOf(world)).toEqual([[7, HEAD, 'cancelled']]);
  expect(world.reporter.cancellations).toEqual([
    {
      githubInstallationId: INSTALLATION,
      githubRepoId: REPOSITORY,
      fullName: FULL_NAME,
      prNumber: 7,
      headSha: HEAD,
      evaluationId: id,
    },
  ]);
  expect(world.pending.targets).toEqual([
    { githubInstallationId: INSTALLATION, githubRepoId: REPOSITORY, prNumber: 7, headShas: [HEAD] },
  ]);
  expect(await world.queued()).toEqual([]);
  expect(world.logs.lines()).toContainEqual(
    expect.objectContaining({ msg: 'sweep_installation.swept', closed: 1, queued: 0 }),
  );
});

test('the pull request is asked of GitHub once however many evaluations of it are lost, and is cleared once', async () => {
  const world = await sweepWorld();
  closePull(world);
  await seedAged(world, { prNumber: 7, headSha: HEAD, result: 'in_progress', ageMinutes: 40 });
  await seedAged(world, { prNumber: 7, headSha: NEWER_HEAD, result: 'in_progress', ageMinutes: 35 });
  await world.runSweep();
  expect(world.calls()).toEqual(['listOpenPullRequests', 'getPullRequest']);
  expect(world.pending.targets).toHaveLength(1);
  expect(world.reporter.cancellations.map((target) => target.headSha)).toEqual([HEAD, NEWER_HEAD]);
  expect((await resultsOf(world)).map(([, , result]) => result)).toEqual(['cancelled', 'cancelled']);
});

test('a pull request GitHub no longer shows is cleared too', async () => {
  const world = await sweepWorld();
  await seedAged(world, { prNumber: 8, headSha: HEAD, result: 'in_progress', ageMinutes: 31 });
  await world.runSweep();
  expect(await resultsOf(world)).toEqual([[8, HEAD, 'cancelled']]);
  expect(world.pending.targets.map((target) => target.prNumber)).toEqual([8]);
});

test('an evaluation younger than 30 minutes is a job that still runs: a closed pull request is left to its own close job and GitHub is not asked', async () => {
  const world = await sweepWorld();
  closePull(world);
  await seedAged(world, { prNumber: 7, headSha: HEAD, result: 'in_progress', ageMinutes: 29 });
  await world.runSweep();
  expect(world.calls()).toEqual(['listOpenPullRequests']);
  expect(await resultsOf(world)).toEqual([[7, HEAD, 'in_progress']]);
  expect(world.reporter.cancellations).toEqual([]);
  expect(world.pending.targets).toEqual([]);
});

test('an evaluation with a verdict is not touched, however old, and a closed pull request with only verdicts is not asked about', async () => {
  const world = await sweepWorld();
  closePull(world);
  await seedAged(world, { prNumber: 7, headSha: HEAD, result: 'success', ageMinutes: 5000 });
  await world.runSweep();
  expect(world.calls()).toEqual(['listOpenPullRequests']);
  expect(await resultsOf(world)).toEqual([[7, HEAD, 'success']]);
});

test('a lost evaluation of an open pull request at its head SHA is queued again under the dedupe window of the sweep', async () => {
  const world = await sweepWorld();
  await seedAged(world, { prNumber: 7, headSha: HEAD, result: 'in_progress', ageMinutes: 45 });
  await world.runSweep();
  expect(
    world.enqueuer.calls.map((call) => [call.job.type, call.options.dedupeKey, call.options.dedupeWindowSeconds]),
  ).toEqual([['evaluate-pr', 'sweep:9000:7', 300]]);
  expect(world.calls()).toEqual(['listOpenPullRequests']);
  world.clock.advance(MINUTE);
  await world.runSweep(undefined, 'sweep-2');
  expect(await world.queuedPulls()).toEqual([7]);
});

test('a lost evaluation of a head SHA the pull request has moved on from is cancelled where it would be found by every sweep, and the new head SHA is queued', async () => {
  const world = await sweepWorld();
  openPull(world, 7, NEWER_HEAD);
  const id = await seedAged(world, { prNumber: 7, headSha: HEAD, result: 'in_progress', ageMinutes: 31 });
  await world.runSweep();
  expect(await resultsOf(world)).toEqual([[7, HEAD, 'cancelled']]);
  expect(world.reporter.cancellations).toEqual([
    {
      githubInstallationId: INSTALLATION,
      githubRepoId: REPOSITORY,
      fullName: FULL_NAME,
      prNumber: 7,
      headSha: HEAD,
      evaluationId: id,
    },
  ]);
  expect(await world.queuedPulls()).toEqual([7]);
  expect(world.pending.targets).toEqual([]);
  expect(world.calls()).toEqual(['listOpenPullRequests']);
});

test('a lost evaluation beyond the pages the sweep reads is found by its number: GitHub is asked for the pull request and, when open, it is queued', async () => {
  const world = await sweepWorld();
  for (let number = 8; number <= 1010; number += 1) {
    openPull(world, number);
  }
  await seedAged(world, { prNumber: 7, headSha: HEAD, result: 'in_progress', ageMinutes: 31 });
  await world.runSweep();
  expect(world.calls().filter((method) => method === 'getPullRequest')).toHaveLength(1);
  expect((await world.queuedPulls()).includes(7)).toBe(true);
  // the 1,000 pages read, and the lost one beyond them; pull requests 8 to 10 are beyond the pages and have no lost evaluation
  expect(await world.queuedPulls()).toHaveLength(1001);
});

test('a lost evaluation beyond the pages, of a pull request that has a newer head SHA, is cancelled and the new head SHA queued', async () => {
  const world = await sweepWorld();
  for (let number = 8; number <= 1010; number += 1) {
    openPull(world, number);
  }
  openPull(world, 7, NEWER_HEAD);
  await seedAged(world, { prNumber: 7, headSha: HEAD, result: 'in_progress', ageMinutes: 31 });
  await world.runSweep();
  expect((await resultsOf(world)).find(([number]) => number === 7)).toEqual([7, HEAD, 'cancelled']);
  expect((await world.queuedPulls()).includes(7)).toBe(true);
});

test('a failure of the reporter while the lost evaluation is cancelled leaves the row in progress for the next sweep, and the other repositories are swept', async () => {
  const world = await sweepWorld();
  closePull(world);
  await seedAged(world, { prNumber: 7, headSha: HEAD, result: 'in_progress', ageMinutes: 31 });
  world.reporter.hooks.cancelled = () => Promise.reject(new Error('the Check Run could not be updated'));
  expect(await world.runSweep()).toEqual({ outcome: 'partial' });
  expect(await resultsOf(world)).toEqual([[7, HEAD, 'in_progress']]);
  expect(world.logs.lines()).toContainEqual(expect.objectContaining({ msg: 'sweep.repository_failed', level: 40 }));
});

test('the lost evaluations of another tenant are not cancelled and not queued by the sweep of this one', async () => {
  const world = await sweepWorld();
  const neighbour = await addNeighbour(world, 2);
  await world.raw
    .insertInto('pr_evaluations')
    .values({
      installation_id: (
        await world.raw
          .selectFrom('installations')
          .select('id')
          .where('github_installation_id', '=', neighbour.githubInstallationId)
          .executeTakeFirstOrThrow()
      ).id,
      repository_id: (
        await world.raw
          .selectFrom('repositories')
          .select('id')
          .where('github_repo_id', '=', neighbour.githubRepoId)
          .executeTakeFirstOrThrow()
      ).id,
      pr_number: 7,
      head_sha: HEAD,
      result: 'in_progress',
      updated_at: new Date(world.clock.now().getTime() - 90 * MINUTE),
    })
    .execute();
  world.fake.addPullRequest(neighbour.githubInstallationId, neighbour.fullName, pullRequest(7, { state: 'closed' }));
  await world.runSweep();
  expect(world.reporter.cancellations).toEqual([]);
  expect((await world.rows()).map((row) => row.result)).toEqual(['in_progress']);
  expect(world.calls()).toEqual(['listOpenPullRequests']);
});
