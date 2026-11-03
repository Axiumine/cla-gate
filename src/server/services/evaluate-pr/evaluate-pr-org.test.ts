// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { seedSignature } from '../../adapters/db/test-support.ts';
import { commit, commitSha, pullRequest } from '../github-pull-contract/test-support.ts';
import { GitHubForbiddenError, GitHubRateLimitedError } from '../ports/github-errors.ts';
import {
  allow,
  engineInput,
  enrol,
  evaluateWorld,
  FULL_NAME,
  INSTALLATION,
  JOB,
  lookups,
  ORG,
  PR_NUMBER,
} from './test-support.ts';

// The organisation membership facts of the job (E07-S04): who is asked about, who is not, and what a lookup that failed does.
// The pull request of the world has three people: the opener, user 7, and the authors of its two commits, users 1 and 2.

const PEOPLE = [7, 1, 2];

/** A world whose allowlist exempts the members of the installing organisation, all three people being members. */
async function exempting() {
  const world = await evaluateWorld();
  await allow(world, { kind: 'org_members', githubId: ORG });
  for (const person of PEOPLE) {
    enrol(world, person);
  }
  return world;
}

const membersOf = (world: Awaited<ReturnType<typeof exempting>>): number[] =>
  [...(engineInput(world).orgMembers.get(ORG) ?? [])].sort((a, b) => a - b);

test('with the members of the organisation on the allowlist, every person who is neither signed nor allowlisted is looked up, and the members are the fact the engine gets', async () => {
  const world = await exempting();
  expect(await world.run()).toEqual({ outcome: 'evaluated' });
  expect(lookups(world)).toBe(3);
  expect(membersOf(world)).toEqual([1, 2, 7]);
});

test('a person who is not a member is no member of the fact, and a pending invitation is not a membership', async () => {
  const world = await exempting();
  world.fake.addMembership(INSTALLATION, 'org-1', 'user-1', {
    state: 'pending',
    role: 'member',
    userId: parseGithubId(1),
  });
  world.fake.addMembership(INSTALLATION, 'org-1', 'user-2', {
    state: 'active',
    role: 'member',
    userId: parseGithubId(99),
  });
  await world.run();
  expect(membersOf(world)).toEqual([7]);
});

test('a person who holds a signature of the active document is not looked up', async () => {
  const world = await exempting();
  await seedSignature(world.raw, world.tenant, 1);
  await world.run();
  expect(lookups(world)).toBe(2);
  expect(membersOf(world)).toEqual([2, 7]);
  expect(engineInput(world).signatures.map((fact) => fact.githubId)).toEqual([1]);
});

test('a person on the allowlist as a user is not looked up', async () => {
  const world = await exempting();
  await allow(world, { kind: 'user', githubId: 2 });
  await world.run();
  expect(lookups(world)).toBe(2);
  expect(membersOf(world)).toEqual([1, 7]);
});

test('a bot is never looked up: it is not a person', async () => {
  const world = await exempting();
  world.fake.setPullRequestCommits(INSTALLATION, FULL_NAME, PR_NUMBER, [
    commit(1),
    commit(2, { author: { id: parseGithubId(2), login: 'user-2', type: 'Bot' } }),
  ]);
  await world.run();
  expect(lookups(world)).toBe(2);
  expect(membersOf(world)).toEqual([1, 7]);
});

test('a person who is named only by a trailer has no login to ask about and is never looked up', async () => {
  const world = await exempting();
  const trailer = 'Co-authored-by: Pat <555+pat@users.noreply.github.com>';
  world.fake.setPullRequestCommits(INSTALLATION, FULL_NAME, PR_NUMBER, [
    commit(1),
    commit(2, { message: `change 2\n\n${trailer}` }),
  ]);
  enrol(world, 555);
  await world.run();
  expect(lookups(world)).toBe(3);
  expect(engineInput(world).orgMembers.get(ORG)?.has(555)).toBe(false);
});

test('without an entry for the members of the organisation there is no lookup at all', async () => {
  const world = await evaluateWorld();
  for (const person of PEOPLE) {
    enrol(world, person);
  }
  await world.run();
  expect(lookups(world)).toBe(0);
  expect(engineInput(world).orgMembers).toEqual(new Map());
});

test('an entry for the members of another organisation asks nothing about this one', async () => {
  const world = await evaluateWorld();
  await allow(world, { kind: 'org_members', githubId: 123_456 });
  await world.run();
  expect(lookups(world)).toBe(0);
});

test('an entry for the members of the organisation that belongs to one repository applies to that repository only', async () => {
  const world = await evaluateWorld();
  await world.raw
    .insertInto('repositories')
    .values({
      installation_id: world.tenant.installationId,
      github_repo_id: 9001,
      full_name: 'org-1/other',
      cla_document_id: null,
    })
    .execute();
  const other = await world.raw
    .selectFrom('repositories')
    .select('id')
    .where('full_name', '=', 'org-1/other')
    .executeTakeFirstOrThrow();
  await allow(world, { kind: 'org_members', githubId: ORG, repositoryId: other.id });
  await world.run();
  expect(lookups(world)).toBe(0);
  await allow(world, { kind: 'org_members', githubId: ORG, repositoryId: world.tenant.repositoryId });
  await world.run({ ...JOB, trigger: 'recheck' });
  expect(lookups(world)).toBe(3);
});

test('a repository without a CLA has no signature to read, so every person is looked up', async () => {
  const world = await evaluateWorld({ cla: false });
  await allow(world, { kind: 'org_members', githubId: ORG });
  await world.run();
  expect(lookups(world)).toBe(3);
  expect(world.timeline).not.toContain('db:select signatures');
});

test('an App without the permission to read members can only deny: the person is no member, the job goes on, and the gap is logged', async () => {
  const world = await exempting();
  world.fake.failNext('getOrgMembership', new GitHubForbiddenError('GET /orgs/{org}/memberships/{username}'));
  expect(await world.run()).toEqual({ outcome: 'evaluated' });
  expect(membersOf(world)).toHaveLength(2);
  expect(world.logs.lines()).toContainEqual(
    expect.objectContaining({ msg: 'members_permission_missing', githubInstallationId: INSTALLATION }),
  );
});

test('a rate-limited lookup fails the job: no verdict is stored and nothing is reported', async () => {
  const world = await exempting();
  world.fake.failNext('getOrgMembership', new GitHubRateLimitedError(30, 'secondary'));
  await expect(world.run()).rejects.toBeInstanceOf(GitHubRateLimitedError);
  expect(world.evaluate).not.toHaveBeenCalled();
  expect(world.reporter.published).toEqual([]);
  expect((await world.rows()).map((row) => [row.result, row.details])).toEqual([['in_progress', {}]]);
});

test('a pull request of twenty authors and an opener is looked up eight at a time, and every one of the twenty-one is asked', async () => {
  const world = await exempting();
  const authors = Array.from({ length: 20 }, (_, index) => commit(100 + index));
  world.fake.addPullRequest(
    INSTALLATION,
    FULL_NAME,
    pullRequest(PR_NUMBER, { commitCount: 20, headSha: commitSha(119) }),
  );
  world.fake.setPullRequestCommits(INSTALLATION, FULL_NAME, PR_NUMBER, authors);
  // Each group of lookups is held until the whole group has arrived, so the peak does not depend on timing: eight, eight, five.
  const groups = [8, 8, 5].map((size) => ({ size, arrived: 0, open: Promise.withResolvers<undefined>() }));
  let active = 0;
  let peak = 0;
  for (const group of groups.flatMap((one) => Array.from({ length: one.size }, () => one))) {
    world.fake.beforeNext('getOrgMembership', async () => {
      active += 1;
      peak = Math.max(peak, active);
      group.arrived += 1;
      if (group.arrived === group.size) {
        group.open.resolve(undefined);
      }
      await group.open.promise;
      active -= 1;
    });
  }
  await world.run();
  expect(peak).toBe(8);
  expect(lookups(world)).toBe(21);
});

test('no login reaches the engine: the facts are numeric ids and types', async () => {
  const world = await exempting();
  await world.run();
  const text = JSON.stringify(engineInput(world));
  expect(text).not.toContain('login');
  expect(text).not.toContain('user-7');
});
