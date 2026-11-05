// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { statesOf, touchedOf } from '../close-pr/test-support.ts';
import { pullRequest } from '../github-pull-contract/test-support.ts';
import {
  addNeighbour,
  FULL_NAME,
  HEAD,
  INSTALLATION,
  NEWER_HEAD,
  openPull,
  type SweepWorld,
  seedAged,
  sweepWorld,
} from './test-support.ts';

// What the sweep does to `pr_state` (E15-S01): after it read every page of a repository's open pull requests, the latest row of a
// pull request the listing does not show is marked closed (a missed `closed` delivery), and the latest row of one it shows is
// marked open (a missed `reopened`); a listing that failed on a page, or that was cut, changes nothing; a row touched after the
// listing began is not closed; `updated_at` is never touched; and no other repository or tenant is. Pull request 7 is open on
// GitHub in the world of these tests; 9 and 10 are not.

const GONE = 9;
const ALSO_GONE = 10;
const OLDER = NEWER_HEAD;

/** Opens the pull requests `first` to `last` on GitHub's side, at the head SHA of the world. */
function openMany(world: SweepWorld, first: number, last: number): void {
  for (let number = first; number <= last; number += 1) {
    world.fake.addPullRequest(INSTALLATION, FULL_NAME, pullRequest(number, { headSha: HEAD }));
  }
}

const stateOf = async (world: SweepWorld) =>
  new Map((await statesOf(world)).map(([pr, head, state]) => [`${pr}@${head}`, state]));

test('a pull request the listing does not show is closed on its latest row, and one it shows stays open', async () => {
  const world = await sweepWorld();
  await seedAged(world, { prNumber: 7, headSha: HEAD, result: 'success', ageMinutes: 5 });
  await seedAged(world, { prNumber: GONE, headSha: HEAD, result: 'failure', ageMinutes: 5 });
  await world.runSweep();
  expect(await statesOf(world)).toEqual([
    [7, HEAD, 'open'],
    [GONE, HEAD, 'closed'],
  ]);
  expect(world.logs.lines()).toContainEqual(
    expect.objectContaining({ msg: 'sweep_installation.swept', markedClosed: 1, markedOpen: 0 }),
  );
});

test('only the latest row of a missing pull request is marked: an older head SHA it was evaluated at is left as it is, and a row touched last wins over a newer head SHA', async () => {
  const world = await sweepWorld();
  await seedAged(world, { prNumber: GONE, headSha: HEAD, result: 'success', ageMinutes: 30 });
  await seedAged(world, { prNumber: GONE, headSha: OLDER, result: 'failure', ageMinutes: 20 });
  await seedAged(world, { prNumber: ALSO_GONE, headSha: HEAD, result: 'failure', ageMinutes: 10 });
  await seedAged(world, { prNumber: ALSO_GONE, headSha: OLDER, result: 'success', ageMinutes: 40 });
  await world.runSweep();
  expect(await stateOf(world)).toEqual(
    new Map([
      [`${GONE}@${HEAD}`, 'open'],
      [`${GONE}@${OLDER}`, 'closed'],
      [`${ALSO_GONE}@${HEAD}`, 'closed'],
      [`${ALSO_GONE}@${OLDER}`, 'open'],
    ]),
  );
});

test('a row that was touched after the listing began is left alone, and one touched at that instant is not: the pull request may have been opened since', async () => {
  const world = await sweepWorld();
  await seedAged(world, { prNumber: GONE, headSha: HEAD, result: 'in_progress', ageMinutes: -1 });
  await seedAged(world, { prNumber: ALSO_GONE, headSha: HEAD, result: 'failure', ageMinutes: 0 });
  await world.runSweep();
  expect(await statesOf(world)).toEqual([
    [GONE, HEAD, 'open'],
    [ALSO_GONE, HEAD, 'closed'],
  ]);
});

test('a pull request the listing shows is opened again on its latest row when a reopening was missed, and its older rows are left as they are', async () => {
  const world = await sweepWorld();
  await seedAged(world, { prNumber: 7, headSha: OLDER, result: 'success', ageMinutes: 20, prState: 'closed' });
  await seedAged(world, { prNumber: 7, headSha: HEAD, result: 'success', ageMinutes: 10, prState: 'closed' });
  await world.runSweep();
  expect(await stateOf(world)).toEqual(
    new Map([
      [`7@${OLDER}`, 'closed'],
      [`7@${HEAD}`, 'open'],
    ]),
  );
  expect(world.logs.lines()).toContainEqual(
    expect.objectContaining({ msg: 'sweep_installation.swept', markedClosed: 0, markedOpen: 1 }),
  );
});

test('the sweep never touches updated_at, whichever way it changes the state', async () => {
  const world = await sweepWorld();
  await seedAged(world, { prNumber: 7, headSha: HEAD, result: 'success', ageMinutes: 5, prState: 'closed' });
  await seedAged(world, { prNumber: GONE, headSha: HEAD, result: 'failure', ageMinutes: 5 });
  const before = await touchedOf(world);
  await world.runSweep();
  expect(await touchedOf(world)).toEqual(before);
});

test('a listing that fails on its second page changes no state, whatever it showed on the first, and the failure is the usual one', async () => {
  const world = await sweepWorld();
  openMany(world, 101, 250);
  await seedAged(world, { prNumber: GONE, headSha: HEAD, result: 'failure', ageMinutes: 5 });
  await seedAged(world, { prNumber: 101, headSha: HEAD, result: 'failure', ageMinutes: 5, prState: 'closed' });
  let listings = 0;
  world.fake.observe((call) => {
    listings += call.method === 'listOpenPullRequests' ? 1 : 0;
    if (call.method === 'listOpenPullRequests' && listings === 2) {
      world.fake.failNext('listOpenPullRequests', new Error('GitHub answered 502'));
    }
  });
  expect(await world.runSweep()).toEqual({ outcome: 'partial' });
  expect(listings).toBe(2);
  expect(await statesOf(world)).toEqual([
    [GONE, HEAD, 'open'],
    [101, HEAD, 'closed'],
  ]);
  expect(world.logs.lines()).toContainEqual(expect.objectContaining({ msg: 'sweep.repository_failed' }));
});

test('a listing that was cut at 1,000 pull requests changes no state: the pull requests beyond it are not known to be closed', async () => {
  const world = await sweepWorld();
  openMany(world, 101, 1130);
  await seedAged(world, { prNumber: GONE, headSha: HEAD, result: 'success', ageMinutes: 5 });
  await seedAged(world, { prNumber: 101, headSha: HEAD, result: 'success', ageMinutes: 5, prState: 'closed' });
  await world.runSweep();
  expect(await statesOf(world)).toEqual([
    [GONE, HEAD, 'open'],
    [101, HEAD, 'closed'],
  ]);
});

test('a listing with no open pull request closes the latest row of every pull request of the repository and opens none', async () => {
  const world = await sweepWorld();
  world.fake.addPullRequest(INSTALLATION, FULL_NAME, pullRequest(7, { state: 'closed' }));
  await seedAged(world, { prNumber: 7, headSha: HEAD, result: 'success', ageMinutes: 5 });
  await seedAged(world, { prNumber: GONE, headSha: HEAD, result: 'failure', ageMinutes: 5 });
  await world.runSweep();
  expect(await statesOf(world)).toEqual([
    [7, HEAD, 'closed'],
    [GONE, HEAD, 'closed'],
  ]);
});

test('the reaper that finds a stale pull request closed on GitHub closes every row of it, each head SHA, as the close job does', async () => {
  const world = await sweepWorld();
  world.fake.addPullRequest(INSTALLATION, FULL_NAME, pullRequest(GONE, { state: 'closed' }));
  await seedAged(world, { prNumber: GONE, headSha: OLDER, result: 'success', ageMinutes: 90 });
  await seedAged(world, { prNumber: GONE, headSha: HEAD, result: 'in_progress', ageMinutes: 60 });
  await world.runSweep();
  expect(await statesOf(world)).toEqual([
    [GONE, OLDER, 'closed'],
    [GONE, HEAD, 'closed'],
  ]);
});

test('the same pull request numbers in another tenant keep their state, closed or open, when the repository is swept', async () => {
  const world = await sweepWorld();
  const neighbour = await addNeighbour(world, 2);
  const stored = await world.raw
    .selectFrom('repositories')
    .select(['id', 'installation_id'])
    .where('github_repo_id', '=', neighbour.githubRepoId)
    .executeTakeFirstOrThrow();
  await world.raw
    .insertInto('pr_evaluations')
    .values(
      [
        { pr_number: GONE, pr_state: 'open' as const },
        { pr_number: 7, pr_state: 'closed' as const },
      ].map((row) => ({
        ...row,
        installation_id: stored.installation_id,
        repository_id: stored.id,
        head_sha: HEAD,
        result: 'success' as const,
        updated_at: new Date('2026-11-01T10:00:00Z'),
      })),
    )
    .execute();
  await seedAged(world, { prNumber: GONE, headSha: HEAD, result: 'success', ageMinutes: 5 });
  await seedAged(world, { prNumber: 7, headSha: HEAD, result: 'success', ageMinutes: 5, prState: 'closed' });
  openPull(world, 7);
  await world.runSweep({ type: 'sweep-installation', githubInstallationId: INSTALLATION }, 'sweep-1');
  const rows = await world.raw
    .selectFrom('pr_evaluations')
    .select(['installation_id', 'pr_number', 'pr_state'])
    .orderBy('id')
    .execute();
  expect(rows).toEqual([
    { installation_id: stored.installation_id, pr_number: GONE, pr_state: 'open' },
    { installation_id: stored.installation_id, pr_number: 7, pr_state: 'closed' },
    { installation_id: world.tenant.installationId, pr_number: GONE, pr_state: 'closed' },
    { installation_id: world.tenant.installationId, pr_number: 7, pr_state: 'open' },
  ]);
});
