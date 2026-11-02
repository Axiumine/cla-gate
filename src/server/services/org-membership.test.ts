// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { migratedTestDatabase, seedTenant } from '../adapters/db/test-support.ts';
import { createLogger } from '../adapters/http/logger.ts';
import { captureLogs } from '../test-support.ts';
import { createOrgMembership } from './org-membership.ts';
import type { GitHubOrgMembership } from './ports/github.ts';
import { GitHubForbiddenError, GitHubRateLimitedError, GitHubUnavailableError } from './ports/github-errors.ts';
import { FakeGitHub } from './test-support.ts';

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
  const service = createOrgMembership({
    db,
    github: fake,
    logger: createLogger({ logLevel: 'info' }, logs.destination),
  });
  const ask = (login = 'person', githubInstallationId = INSTALLATION) =>
    service.isOrgMember({ githubInstallationId, userGithubId: PERSON, login });
  return { db, fake, logs, ask };
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
