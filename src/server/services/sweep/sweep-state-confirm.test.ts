// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { MAX_STATE_CONFIRMATIONS } from '../../domain/sweep.ts';
import { statesOf } from '../close-pr/test-support.ts';
import { pullRequest } from '../github-pull-contract/test-support.ts';
import { FULL_NAME, HEAD, INSTALLATION, openPull, type SweepWorld, seedAged, sweepWorld } from './test-support.ts';

// The listing of the open pull requests is read page by page while pull requests close and open, so the sweep does not take it for the
// truth about `pr_state` (E15-S01): it asks GitHub about each row it would change, and changes it only when GitHub shows the pull
// request in the state the row would take. These tests move the pull requests on GitHub's side between the steps of the sweep.
// Pull request 7 is open in the world of these tests.

const SKIPPED = 50;
const GONE = 9;
const NEVER_LISTED = 200;
const PAGE = 100;

/** Opens the pull requests `first` to `last` on GitHub's side, at the head SHA of the world. */
function openMany(world: SweepWorld, first: number, last: number): void {
  for (let number = first; number <= last; number += 1) {
    openPull(world, number);
  }
}

/** Closes pull request `prNumber` on GitHub's side, as the next call of `method` begins. */
function closeBefore(world: SweepWorld, method: 'listOpenPullRequests' | 'getPullRequest', prNumber: number): void {
  world.fake.beforeNext(method, () => {
    world.fake.addPullRequest(INSTALLATION, FULL_NAME, pullRequest(prNumber, { headSha: HEAD, state: 'closed' }));
    return Promise.resolve();
  });
}

const stateOf = async (world: SweepWorld) => new Map((await statesOf(world)).map(([pr, , state]) => [pr, state]));

/** The pull requests whose row is closed, in number order. */
const closedOf = async (world: SweepWorld) =>
  [...(await stateOf(world))]
    .filter(([, state]) => state === 'closed')
    .map(([prNumber]) => prNumber)
    .sort((left, right) => left - right);

/** How many times GitHub was asked about one pull request. */
const asked = (world: SweepWorld): number => world.calls().filter((method) => method === 'getPullRequest').length;

/** The sweep logged that it marked `closed` rows closed and `reopened` rows open. */
const marked = (world: SweepWorld, closed: number, reopened: number): void => {
  expect(world.logs.lines()).toContainEqual(
    expect.objectContaining({ msg: 'sweep_installation.swept', markedClosed: closed, markedOpen: reopened }),
  );
};

test('an open pull request the listing skipped because another one closed while its pages were read keeps its state, and one GitHub shows closed is closed', async () => {
  const world = await sweepWorld();
  openMany(world, 8, 150);
  await seedAged(world, { prNumber: SKIPPED, headSha: HEAD, result: 'failure', ageMinutes: 5 });
  await seedAged(world, { prNumber: NEVER_LISTED, headSha: HEAD, result: 'failure', ageMinutes: 5 });
  // Pull request 150 is on the first page, which is read; it closes before the second, so everything after it moves up by one place and
  // the pull request that was the first of the second page (50) is on neither page.
  world.fake.beforeNext('listOpenPullRequests', () => Promise.resolve());
  closeBefore(world, 'listOpenPullRequests', 150);
  await world.runSweep();
  const listed = world.fake.calls.filter((call) => call.method === 'listOpenPullRequests');
  expect(listed).toHaveLength(2);
  expect((await world.fake.getPullRequest(INSTALLATION, FULL_NAME, SKIPPED))?.state).toBe('open');
  expect(await stateOf(world)).toEqual(
    new Map([
      [SKIPPED, 'open'],
      [NEVER_LISTED, 'closed'],
    ]),
  );
  marked(world, 1, 0);
});

test('a pull request the listing shows that closed after the listing is not opened again: GitHub is asked, and the row stays closed', async () => {
  const world = await sweepWorld();
  await seedAged(world, { prNumber: 7, headSha: HEAD, result: 'success', ageMinutes: 5, prState: 'closed' });
  closeBefore(world, 'getPullRequest', 7);
  await world.runSweep();
  expect(await stateOf(world)).toEqual(new Map([[7, 'closed']]));
  marked(world, 0, 0);
});

test('a pull request that was reopened after the listing missed it is not closed: GitHub shows it open', async () => {
  const world = await sweepWorld();
  await seedAged(world, { prNumber: GONE, headSha: HEAD, result: 'failure', ageMinutes: 5 });
  closeBefore(world, 'listOpenPullRequests', GONE);
  world.fake.beforeNext('getPullRequest', () => {
    openPull(world, GONE);
    return Promise.resolve();
  });
  await world.runSweep();
  expect(await stateOf(world)).toEqual(new Map([[GONE, 'open']]));
});

test('a pull request the listing shows is opened again when GitHub shows it open, and the question is asked once for the row', async () => {
  const world = await sweepWorld();
  await seedAged(world, { prNumber: 7, headSha: HEAD, result: 'success', ageMinutes: 5, prState: 'closed' });
  await world.runSweep();
  expect(await stateOf(world)).toEqual(new Map([[7, 'open']]));
  expect(asked(world)).toBe(1);
});

test('one sweep asks about at most the cap of pull requests, the ones touched last first, and the next sweep goes on with the rest', async () => {
  const world = await sweepWorld();
  const total = MAX_STATE_CONFIRMATIONS + 10;
  for (let index = 0; index < total; index += 1) {
    await seedAged(world, { prNumber: 300 + index, headSha: HEAD, result: 'failure', ageMinutes: 1 + index });
  }
  await world.runSweep();
  expect(await closedOf(world)).toEqual(Array.from({ length: MAX_STATE_CONFIRMATIONS }, (_, index) => 300 + index));
  expect(asked(world)).toBe(MAX_STATE_CONFIRMATIONS);
  world.clock.advance(60_000);
  await world.runSweep(undefined, 'sweep-2');
  expect(await closedOf(world)).toHaveLength(total);
});

test('a GitHub that fails when asked about a row leaves every row as it was, after the evaluations of the sweep were sent', async () => {
  const world = await sweepWorld();
  await seedAged(world, { prNumber: GONE, headSha: HEAD, result: 'failure', ageMinutes: 5 });
  world.fake.failNext('getPullRequest', new Error('GitHub answered 502'));
  expect(await world.runSweep()).toEqual({ outcome: 'partial' });
  expect(await stateOf(world)).toEqual(new Map([[GONE, 'open']]));
  expect(await world.queuedPulls()).toEqual([7]);
  expect(world.logs.lines()).toContainEqual(expect.objectContaining({ msg: 'sweep.repository_failed' }));
});

test('a listing of more than one page is read whole before any row is asked about', async () => {
  const world = await sweepWorld();
  openMany(world, 8, PAGE + 20);
  await seedAged(world, { prNumber: NEVER_LISTED, headSha: HEAD, result: 'failure', ageMinutes: 5 });
  await world.runSweep();
  const methods = world.calls();
  expect(methods.filter((method) => method === 'listOpenPullRequests')).toHaveLength(2);
  expect(methods.lastIndexOf('listOpenPullRequests')).toBeLessThan(methods.indexOf('getPullRequest'));
});
