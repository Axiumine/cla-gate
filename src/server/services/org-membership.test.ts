// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { migratedTestDatabase, seedTenant } from '../adapters/db/test-support.ts';
import { createLogger } from '../adapters/http/logger.ts';
import { captureLogs } from '../test-support.ts';
import { createOrgMembership } from './org-membership.ts';
import { createOrgMembershipCache, MEMBER_TTL_MS, NOT_MEMBER_TTL_MS } from './org-membership-cache.ts';
import type { GitHubOrgMembership } from './ports/github.ts';
import { GitHubForbiddenError, GitHubRateLimitedError, GitHubUnavailableError } from './ports/github-errors.ts';
import { FakeClock, FakeGitHub } from './test-support.ts';

// The membership lookup of the evaluation job (E07-S10, built for E07-S04): who is a member, and what each way of not being
// one, or of not being able to tell, answers.

const INSTALLATION = parseGithubId(5000);
const PERSON = parseGithubId(77);
const ACTIVE: GitHubOrgMembership = { state: 'active', role: 'member', userId: PERSON };

async function lookupWorld() {
  const { db } = await migratedTestDatabase();
  await seedTenant(db, 1);
  const fake = new FakeGitHub();
  fake.addInstallation(
    {
      id: INSTALLATION,
      account: { id: parseGithubId(7000), login: 'org-1', type: 'Organization' },
      suspendedAt: null,
      permissions: {},
    },
    [],
  );
  const logs = captureLogs();
  const clock = new FakeClock('2026-11-02T10:00:00Z');
  const service = createOrgMembership({
    db,
    github: fake,
    logger: createLogger({ logLevel: 'info' }, logs.destination),
    cache: createOrgMembershipCache(clock),
  });
  const ask = (login = 'person', githubInstallationId = INSTALLATION) =>
    service.isOrgMember({ githubInstallationId, userGithubId: PERSON, login });
  return { db, fake, logs, clock, ask };
}

test('an active member of the organisation that installed the App, by id, is a member', async () => {
  const { fake, ask } = await lookupWorld();
  fake.addMembership(INSTALLATION, 'org-1', 'person', ACTIVE);
  expect(await ask()).toBe('member');
  expect(fake.calls.map((call) => call.method)).toEqual(['getOrgMembership']);
});

test('a pending invitation is not a membership', async () => {
  const { fake, ask } = await lookupWorld();
  fake.addMembership(INSTALLATION, 'org-1', 'person', { ...ACTIVE, state: 'pending' });
  expect(await ask()).toBe('not_member');
});

test('a person GitHub does not list as a member is not a member', async () => {
  const { ask } = await lookupWorld();
  expect(await ask()).toBe('not_member');
});

test('a login that now belongs to another account is not a member: the id decides, never the login', async () => {
  const { fake, ask } = await lookupWorld();
  fake.addMembership(INSTALLATION, 'org-1', 'person', { ...ACTIVE, userId: parseGithubId(78) });
  expect(await ask()).toBe('not_member');
});

test('an installation on a user account has no members, and GitHub is not asked', async () => {
  const { db, fake, ask } = await lookupWorld();
  await db.updateTable('installations').set({ account_type: 'User' }).execute();
  fake.addMembership(INSTALLATION, 'org-1', 'person', ACTIVE);
  expect(await ask()).toBe('not_member');
  expect(fake.calls).toEqual([]);
});

test('an installation nobody stored has no members, and GitHub is not asked', async () => {
  const { fake, ask } = await lookupWorld();
  expect(await ask('person', parseGithubId(31_337))).toBe('not_member');
  expect(fake.calls).toEqual([]);
});

test('a refusal that is no rate limit means the App lacks the permission: the verdict is permission_missing, logged with the installation and nothing about the person', async () => {
  const { fake, logs, ask } = await lookupWorld();
  fake.failNext('getOrgMembership', new GitHubForbiddenError('GET /orgs/{org}/memberships/{username}'));
  expect(await ask('secret-login')).toBe('permission_missing');
  expect(logs.lines()).toContainEqual(
    expect.objectContaining({ level: 40, msg: 'members_permission_missing', githubInstallationId: INSTALLATION }),
  );
  expect(logs.text()).not.toContain('secret-login');
});

test.each([
  ['a rate limit', new GitHubRateLimitedError(30, 'primary')],
  ['an outage', new GitHubUnavailableError('GitHub answered 503')],
])('%s is not an answer: the lookup fails with it', async (_name, failure) => {
  const { fake, ask } = await lookupWorld();
  fake.failNext('getOrgMembership', failure);
  await expect(ask()).rejects.toBe(failure);
});

// What the service remembers (E07-S10): a verdict of GitHub's is kept per (installation, person) for 10 minutes if it is a
// member and 2 if it is not; a failure and a missing permission are kept never; and a second tenant is never answered from
// the first one's entry.

const lookups = (fake: FakeGitHub): number => fake.calls.filter((call) => call.method === 'getOrgMembership').length;

test.each([
  ['member', ACTIVE, MEMBER_TTL_MS],
  ['not_member', { ...ACTIVE, state: 'pending' } satisfies GitHubOrgMembership, NOT_MEMBER_TTL_MS],
])(
  'a %s verdict is kept until the last millisecond of its time: GitHub is asked again only after',
  async (verdict, membership, ttlMs) => {
    const { fake, clock, ask } = await lookupWorld();
    fake.addMembership(INSTALLATION, 'org-1', 'person', membership);
    expect(await ask()).toBe(verdict);
    clock.advance(ttlMs - 1);
    expect(await ask()).toBe(verdict);
    expect(lookups(fake)).toBe(1);
    clock.advance(1);
    expect(await ask()).toBe(verdict);
    expect(lookups(fake)).toBe(2);
  },
);

test('a person who joined the organisation is asked about again when the 2 minutes of a not_member are over', async () => {
  const { fake, clock, ask } = await lookupWorld();
  expect(await ask()).toBe('not_member');
  fake.addMembership(INSTALLATION, 'org-1', 'person', ACTIVE);
  clock.advance(NOT_MEMBER_TTL_MS - 1);
  expect(await ask()).toBe('not_member');
  clock.advance(1);
  expect(await ask()).toBe('member');
});

test('the verdict is kept for the person, not for the login they were asked under', async () => {
  const { fake, ask } = await lookupWorld();
  fake.addMembership(INSTALLATION, 'org-1', 'person', ACTIVE);
  expect(await ask('person')).toBe('member');
  expect(await ask('renamed-person')).toBe('member');
  expect(lookups(fake)).toBe(1);
});

test.each([
  ['a rate limit', new GitHubRateLimitedError(30, 'primary')],
  ['an outage', new GitHubUnavailableError('GitHub answered 503')],
])('%s is never kept: the next question goes to GitHub again', async (_name, failure) => {
  const { fake, ask } = await lookupWorld();
  fake.addMembership(INSTALLATION, 'org-1', 'person', ACTIVE);
  fake.failNext('getOrgMembership', failure);
  await expect(ask()).rejects.toBe(failure);
  expect(await ask()).toBe('member');
  expect(lookups(fake)).toBe(2);
});

test('permission_missing is never kept: once the permission is granted the next question is answered by GitHub', async () => {
  const { fake, ask } = await lookupWorld();
  fake.addMembership(INSTALLATION, 'org-1', 'person', ACTIVE);
  fake.failNext('getOrgMembership', new GitHubForbiddenError('GET /orgs/{org}/memberships/{username}'));
  expect(await ask()).toBe('permission_missing');
  expect(await ask()).toBe('member');
  expect(lookups(fake)).toBe(2);
});

test('an installation on a user account is answered without a request and kept nowhere: it is asked afresh once it is an organisation', async () => {
  const { db, fake, ask } = await lookupWorld();
  fake.addMembership(INSTALLATION, 'org-1', 'person', ACTIVE);
  await db.updateTable('installations').set({ account_type: 'User' }).execute();
  expect(await ask()).toBe('not_member');
  await db.updateTable('installations').set({ account_type: 'Organization' }).execute();
  expect(await ask()).toBe('member');
});

test('a member of one installation gets a fresh lookup in another, can be a stranger there, and each request is made for the installation that asks', async () => {
  const { db, fake, ask } = await lookupWorld();
  await seedTenant(db, 2);
  const other = parseGithubId(10_000);
  fake.addInstallation(
    {
      id: other,
      account: { id: parseGithubId(14_000), login: 'org-2', type: 'Organization' },
      suspendedAt: null,
      permissions: {},
    },
    [],
  );
  fake.addMembership(INSTALLATION, 'org-1', 'person', ACTIVE);
  expect(await ask('person', INSTALLATION)).toBe('member');
  expect(await ask('person', other)).toBe('not_member');
  expect(await ask('person', INSTALLATION)).toBe('member');
  expect(fake.calls.map((call) => [call.method, call.installationId])).toEqual([
    ['getOrgMembership', INSTALLATION],
    ['getOrgMembership', other],
  ]);
});

test('the services of a process share what they learned when they share a cache: a run does not ask what an earlier run was told', async () => {
  const { db } = await migratedTestDatabase();
  await seedTenant(db, 1);
  const fake = new FakeGitHub();
  fake.addInstallation(
    {
      id: INSTALLATION,
      account: { id: parseGithubId(7000), login: 'org-1', type: 'Organization' },
      suspendedAt: null,
      permissions: {},
    },
    [],
  );
  fake.addMembership(INSTALLATION, 'org-1', 'person', ACTIVE);
  const cache = createOrgMembershipCache(new FakeClock('2026-11-02T10:00:00Z'));
  const logger = createLogger({ logLevel: 'silent' });
  const first = createOrgMembership({ db, github: fake, logger, cache });
  const second = createOrgMembership({ db, github: fake.withSignal(new AbortController().signal), logger, cache });
  const query = { githubInstallationId: INSTALLATION, userGithubId: PERSON, login: 'person' };
  expect(await first.isOrgMember(query)).toBe('member');
  expect(await second.isOrgMember(query)).toBe('member');
  expect(lookups(fake)).toBe(1);
});
