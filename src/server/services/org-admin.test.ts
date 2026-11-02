// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { afterEach, expect, test, vi } from 'vitest';
import { createLogger } from '../adapters/http/logger.ts';
import { captureLogs } from '../test-support.ts';
import { id, installation } from './github-contract/test-support.ts';
import { createOrgAdminLookup } from './org-admin.ts';
import type { GitHubOrgMembership } from './ports/github.ts';
import {
  GitHubAuthError,
  GitHubForbiddenError,
  GitHubNotFoundError,
  GitHubRateLimitedError,
  GitHubResponseError,
  GitHubUnavailableError,
  InstallationGoneError,
  InstallationNotAdmittedError,
  InstallationSuspendedError,
  type NotAdmittedReason,
} from './ports/github-errors.ts';
import { orgInstallation, userInstallation, VIEWER, VIEWER_ID } from './role-fixture/test-support.ts';
import { FakeGate, FakeGitHub } from './test-support.ts';

// The org admin role fact (E11-S02) against the in-memory GitHub of E05-S04. What the real adapter does with each answer
// is in adapters/github/org-admin-membership.test.ts.

afterEach(() => {
  vi.useRealTimers();
});

/** The lookup over a fake GitHub that serves installation 11 (`acme`) and installation 12 (`globex`). */
function setup() {
  const gate = new FakeGate();
  const fake = new FakeGitHub({ gate });
  fake.addInstallation(installation(11, 'acme'));
  fake.addInstallation(installation(12, 'globex'));
  const logs = captureLogs();
  const lookup = createOrgAdminLookup({ github: fake, log: createLogger({ logLevel: 'info' }, logs.destination) });
  return { fake, gate, logs, lookup };
}

const ACME = orgInstallation(11, 'acme');

const answer = (
  state: GitHubOrgMembership['state'],
  role: GitHubOrgMembership['role'],
  userId: number = VIEWER_ID,
) => ({
  state,
  role,
  userId: id(userId),
});

test.each([
  ['an active admin with the viewer id', answer('active', 'admin'), true],
  ['an active member', answer('active', 'member'), false],
  ['an active billing manager', answer('active', 'billing_manager'), false],
  ['a pending invitation to be admin', answer('pending', 'admin'), false],
  ['a pending invitation to be member', answer('pending', 'member'), false],
  ['an active admin whose id is not the viewer id (a recycled login)', answer('active', 'admin', 777), false],
])('an organisation installation: %s gives org admin %s', async (_name, membership, expected) => {
  const { fake, lookup } = setup();
  fake.addMembership(id(11), 'acme', 'alice', membership);
  expect(await lookup(ACME, VIEWER)).toBe(expected);
});

test('the organisation is installations.account_login and the handle is the viewer login, and GitHub is asked for installation 11 once', async () => {
  const { fake, lookup } = setup();
  fake.addMembership(id(11), 'acme', 'alice', answer('active', 'admin'));
  expect(await lookup(ACME, VIEWER)).toBe(true);
  expect(fake.calls).toEqual([{ method: 'getOrgMembership', installationId: 11 }]);
});

test('no membership at all (a 404) is not an admin', async () => {
  const { lookup } = setup();
  expect(await lookup(ACME, VIEWER)).toBe(false);
});

test.each([
  ['an organisation that was renamed since the last sync', orgInstallation(11, 'acme-renamed'), VIEWER],
  ['a login that was renamed since the last login', ACME, { githubId: VIEWER_ID, login: 'alice-renamed' }],
])('%s fails closed until the next sync or login', async (_name, stored, viewer) => {
  const { fake, lookup } = setup();
  fake.addMembership(id(11), 'acme', 'alice', answer('active', 'admin'));
  expect(await lookup(stored, viewer)).toBe(false);
});

test.each([
  ['the owner of the account', 501, true],
  ['a person who is not the owner', 502, false],
])('a user installation: %s gives org admin %s and no GitHub call is made', async (_name, viewerId, expected) => {
  const { fake, lookup } = setup();
  fake.addMembership(id(11), 'alice', 'alice', answer('active', 'admin'));
  const viewer = { githubId: id(viewerId), login: 'alice' };
  expect(await lookup(userInstallation(11, 501), viewer)).toBe(expected);
  expect(fake.calls).toEqual([]);
});

test('an account of another type is never served: nobody is its admin and no call is made', async () => {
  const { fake, lookup } = setup();
  fake.addMembership(id(11), 'acme', 'alice', answer('active', 'admin'));
  expect(await lookup(orgInstallation(11, 'acme', { account_type: 'Other' }), VIEWER)).toBe(false);
  expect(fake.calls).toEqual([]);
});

test('a 403 that is a missing permission is logged with the numeric installation id and is not an admin', async () => {
  const { fake, logs, lookup } = setup();
  fake.addMembership(id(11), 'acme', 'alice', answer('active', 'admin'));
  fake.failNext('getOrgMembership', new GitHubForbiddenError('GET /orgs/{org}/memberships/{username}'));
  expect(await lookup(ACME, VIEWER)).toBe(false);
  const warnings = logs.lines().filter((line) => line['msg'] === 'members_permission_missing');
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toMatchObject({ level: 40, githubInstallationId: 11 });
  expect(logs.text()).not.toMatch(/alice|acme/);
});

test.each([
  ['a rate limit', new GitHubRateLimitedError(30, 'primary')],
  ['an outage', new GitHubUnavailableError('GitHub could not be reached')],
  ['a refused App credential', new GitHubAuthError()],
  [
    'an answer that is not what the schema says',
    new GitHubResponseError('GET /orgs/{org}/memberships/{username}', ['role']),
  ],
  ['an unexpected 404', new GitHubNotFoundError('GET /orgs/{org}/memberships/{username}')],
  ['an installation GitHub no longer has', new InstallationGoneError(id(11))],
  ['a suspension GitHub reports', new InstallationSuspendedError(id(11))],
])('%s is thrown, never read as an answer, and logs nothing', async (_name, failure) => {
  const { fake, logs, lookup } = setup();
  fake.addMembership(id(11), 'acme', 'alice', answer('active', 'admin'));
  fake.failNext('getOrgMembership', failure);
  await expect(lookup(ACME, VIEWER)).rejects.toBe(failure);
  expect(logs.text()).toBe('');
});

test.each<NotAdmittedReason>(['rejected', 'deleted', 'suspended', 'unknown', 'not_wired'])(
  'an installation the gate refuses (%s) throws before GitHub is asked',
  async (reason) => {
    const { fake, gate, lookup } = setup();
    fake.addMembership(id(11), 'acme', 'alice', answer('active', 'admin'));
    gate.refuse(id(11), reason);
    await expect(lookup(ACME, VIEWER)).rejects.toEqual(new InstallationNotAdmittedError(reason));
    expect(fake.calls).toEqual([]);
  },
);

test('a lookup that takes longer than 5 s is an outage, at the exact boundary', async () => {
  vi.useFakeTimers();
  const { fake, lookup } = setup();
  fake.addMembership(id(11), 'acme', 'alice', answer('active', 'admin'));
  fake.beforeNext('getOrgMembership', () => new Promise<void>(() => undefined));
  let outcome: unknown = 'pending';
  const running = lookup(ACME, VIEWER).then(
    (admin) => {
      outcome = admin;
    },
    (failure: unknown) => {
      outcome = failure;
    },
  );
  await vi.advanceTimersByTimeAsync(4999);
  expect(outcome).toBe('pending');
  await vi.advanceTimersByTimeAsync(1);
  await running;
  expect(outcome).toBeInstanceOf(GitHubUnavailableError);
});

test('the same viewer is admin of one installation and a member of another: each lookup asks its own installation', async () => {
  const { fake, lookup } = setup();
  fake.addMembership(id(11), 'acme', 'alice', answer('active', 'admin'));
  fake.addMembership(id(12), 'globex', 'alice', answer('active', 'member'));
  expect(await lookup(orgInstallation(11, 'acme'), VIEWER)).toBe(true);
  expect(await lookup(orgInstallation(12, 'globex'), VIEWER)).toBe(false);
  expect(await lookup(orgInstallation(11, 'acme'), VIEWER)).toBe(true);
  expect(fake.calls.map((call) => call.installationId)).toEqual([11, 12, 11]);
});

test('an admin of installation 11 is no admin of installation 12 even when the organisation name is the same', async () => {
  const { fake, lookup } = setup();
  fake.addMembership(id(11), 'acme', 'alice', answer('active', 'admin'));
  expect(await lookup(orgInstallation(12, 'acme'), VIEWER)).toBe(false);
});
