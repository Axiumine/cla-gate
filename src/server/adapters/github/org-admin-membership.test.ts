// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { afterEach, expect, test, vi } from 'vitest';
import { testGitHubKey } from '../../config/test-support.ts';
import { id, installation } from '../../services/github-contract/test-support.ts';
import { createOrgAdminLookup } from '../../services/org-admin.ts';
import {
  GitHubRateLimitedError,
  GitHubUnavailableError,
  InstallationNotAdmittedError,
  type NotAdmittedReason,
} from '../../services/ports/github-errors.ts';
import {
  eventsOf,
  orgInstallation,
  userInstallation,
  VIEWER,
  VIEWER_ID,
} from '../../services/role-fixture/test-support.ts';
import { createLogger } from '../http/logger.ts';
import { clientFixture, json, line, type RouteAnswer, type Routes } from './client-fixture/test-support.ts';
import { httpWorld } from './http-world/test-support.ts';
import { MEMBERSHIP_FIXTURES } from './membership-fixture/test-support.ts';
import { START } from './test-support.ts';

// The org admin role fact (E11-S02) over the real Octokit adapter: MSW answers the fixtures of the membership call and
// the lookup reads them through the adapter's own schema, rate limiter, token provider and error classes.

const MEMBERSHIP = 'GET /orgs/:org/memberships/:username';
const MEMBERSHIP_LINE = 'GET /orgs/acme/memberships/alice';

/** The public-members endpoints say who is a *public* member, so a person who hides it would look like a stranger. They are never used. */
const forbidden: RouteAnswer = () => json({ message: 'the public-members endpoints must not be used' }, 500);

/** The adapter and the lookup over `routes`; a request to a public-members endpoint shows in `calls` and fails the check below. */
function world(routes: Routes, options: Parameters<typeof clientFixture>[1] = {}) {
  const fixture = clientFixture(
    { 'GET /orgs/:org/public_members/:username': forbidden, 'GET /orgs/:org/public_members': forbidden, ...routes },
    options,
  );
  const log = createLogger({ logLevel: 'info' }, fixture.logs.destination);
  const requests = (): string[] => {
    const lines = fixture.calls.map(line);
    expect(lines.filter((each) => each.includes('public_members'))).toEqual([]);
    return lines;
  };
  return { ...fixture, requests, lookup: createOrgAdminLookup({ github: fixture.client, log }) };
}

const failureOf = (promise: Promise<unknown>): Promise<unknown> => promise.catch((error: unknown) => error);

test.each(MEMBERSHIP_FIXTURES)('the adapter reads $name as the port promises', async ({ answer, port }) => {
  const { client, requests } = world({ [MEMBERSHIP]: answer });
  const result = client.getOrgMembership(id(11), 'acme', 'alice');
  if ('returns' in port) {
    expect(await result).toStrictEqual(port.returns);
  } else {
    await expect(result).rejects.toBeInstanceOf(port.throws);
  }
  expect(requests()).toEqual([MEMBERSHIP_LINE]);
});

test.each(MEMBERSHIP_FIXTURES)('the org admin lookup reads $name', async ({ answer, lookup: expected }) => {
  const fixture = world({ [MEMBERSHIP]: answer });
  const outcome = await failureOf(fixture.lookup(orgInstallation(11, 'acme'), VIEWER));
  const warned = fixture.logs.lines().filter((each) => each['msg'] === 'members_permission_missing');
  if ('limitedForSeconds' in expected) {
    expect(outcome).toBeInstanceOf(GitHubRateLimitedError);
    expect(outcome).toMatchObject({ retryAfterSeconds: expected.limitedForSeconds, scope: 'primary' });
    expect(fixture.waits).toEqual([]);
  } else {
    expect(outcome).toBe(expected.admin);
    expect(warned).toHaveLength(expected.permissionMissing ? 1 : 0);
  }
  expect(fixture.requests()).toEqual([MEMBERSHIP_LINE]);
});

/** The epoch second a primary limit that is 10 minutes away resets at, for the clock of the fixture. */
const RESET_IN_10_MINUTES = String(Math.ceil(Date.parse(START) / 1000) + 600);

test.each([
  [
    'x-ratelimit-remaining: 0 with the reset 10 minutes away',
    { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': RESET_IN_10_MINUTES },
    600,
    'primary',
  ],
  ['retry-after alone', { 'retry-after': '90' }, 90, 'secondary'],
  [
    'x-ratelimit-remaining: 0 and a retry-after of 61 s',
    { 'x-ratelimit-remaining': '0', 'retry-after': '61' },
    61,
    'primary',
  ],
])('a 403 with %s is a rate limit, not a missing permission', async (_name, headers, seconds, scope) => {
  const fixture = world({ [MEMBERSHIP]: () => json({ message: 'Forbidden' }, 403, headers) });
  const failure = await failureOf(fixture.lookup(orgInstallation(11, 'acme'), VIEWER));
  expect(failure).toBeInstanceOf(GitHubRateLimitedError);
  expect(failure).toMatchObject({ retryAfterSeconds: seconds, scope });
  expect(fixture.waits).toEqual([]);
  expect(fixture.logs.lines().filter((each) => each['msg'] === 'members_permission_missing')).toEqual([]);
});

afterEach(() => {
  vi.useRealTimers();
});

test('the 403 that is a missing permission logs the numeric installation id and nothing of the person or the organisation', async () => {
  // A clock whose milliseconds spell the viewer's id: the line's own `time` must not look like a leak of the id.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-02T20:01:25.501Z'));
  const fixture = world({ [MEMBERSHIP]: () => json({ message: 'Resource not accessible by integration' }, 403) });
  expect(await fixture.lookup(orgInstallation(11, 'acme'), VIEWER)).toBe(false);
  const warned = fixture.logs.lines().filter((each) => each['msg'] === 'members_permission_missing');
  expect(warned).toHaveLength(1);
  expect(warned[0]).toMatchObject({ level: 40 });
  expect(eventsOf(warned)).toEqual([{ githubInstallationId: 11, msg: 'members_permission_missing' }]);
  expect(JSON.stringify(eventsOf(warned))).not.toMatch(/alice|acme|501/);
});

test.each([
  ['an organisation name with a slash', orgInstallation(11, 'acme/../orgs'), VIEWER],
  ['a login that climbs out of the path', orgInstallation(11, 'acme'), { githubId: VIEWER_ID, login: '../app' }],
  ['an empty login', orgInstallation(11, 'acme'), { githubId: VIEWER_ID, login: '' }],
])('%s is not an admin and no membership request is sent for it', async (_name, stored, viewer) => {
  const fixture = world({
    [MEMBERSHIP]: () => json({ state: 'active', role: 'admin', user: { login: 'alice', id: VIEWER_ID } }),
  });
  expect(await fixture.lookup(stored, viewer)).toBe(false);
  expect(fixture.requests()).toEqual([]);
});

/** An answer that changes with the installation whose token asked, as GitHub's does: the viewer is an admin of 11 only. */
const byToken: RouteAnswer = (call) =>
  json({
    state: 'active',
    role: call.headers.get('authorization') === 'Bearer ghs_made-up-11-1' ? 'admin' : 'member',
    user: { login: 'alice', id: VIEWER_ID },
  });

test('the same viewer is admin of installation 11 and a member of installation 12: each lookup carries its own installation token', async () => {
  const fixture = world({ [MEMBERSHIP]: byToken });
  expect(await fixture.lookup(orgInstallation(11, 'acme'), VIEWER)).toBe(true);
  expect(await fixture.lookup(orgInstallation(12, 'globex'), VIEWER)).toBe(false);
  expect(fixture.requests()).toEqual(['GET /orgs/acme/memberships/alice', 'GET /orgs/globex/memberships/alice']);
  expect(fixture.calls.map((call) => call.headers.get('authorization'))).toEqual([
    'Bearer ghs_made-up-11-1',
    'Bearer ghs_made-up-12-1',
  ]);
});

test.each([
  ['a 500', () => json({ message: 'Server Error' }, 500), 1, []],
  ['a 503, repeated twice', () => json({ message: 'Unavailable' }, 503), 3, [1000, 2000]],
  ['a connection that fails, repeated twice', () => Response.error(), 3, [1000, 2000]],
])('%s is an outage, never an answer', async (_name, answer, requestsMade, waits) => {
  const fixture = world({ [MEMBERSHIP]: answer });
  expect(await failureOf(fixture.lookup(orgInstallation(11, 'acme'), VIEWER))).toBeInstanceOf(GitHubUnavailableError);
  expect([fixture.requests().length, fixture.waits]).toEqual([requestsMade, waits]);
});

test('an answer slower than the request timeout is an outage', async () => {
  // An answer that never comes, and a timeout long enough for the connection to be made first: a timeout of 30 ms that fires
  // in the middle of the TLS handshake leaves a handshake that ends after the test, and the runner reports its error
  // (an unhandled ERR_TLS_CERT_ALTNAME_INVALID) against whichever test runs next.
  const slow = () => new Promise<Response>(() => undefined);
  const fixture = world({ [MEMBERSHIP]: slow }, { timeoutMs: 1000 });
  expect(await failureOf(fixture.lookup(orgInstallation(11, 'acme'), VIEWER))).toBeInstanceOf(GitHubUnavailableError);
});

const signer = testGitHubKey();

/** The whole chain: the token provider mints per installation, MSW answers each token with what that installation sees. */
async function realWorld() {
  const github = await httpWorld(signer);
  github.addInstallation(installation(11, 'acme'));
  github.addInstallation(installation(12, 'globex'));
  github.addMembership(id(11), 'acme', 'alice', { state: 'active', role: 'admin', userId: VIEWER_ID });
  github.addMembership(id(12), 'globex', 'alice', { state: 'active', role: 'member', userId: VIEWER_ID });
  const log = createLogger({ logLevel: 'info' }, { write: () => undefined });
  return { github, lookup: createOrgAdminLookup({ github: github.client, log }) };
}

test('with real tokens: admin of installation 11, a member of installation 12, and each token sees only its own installation', async () => {
  const { github, lookup } = await realWorld();
  expect(await lookup(orgInstallation(11, 'acme'), VIEWER)).toBe(true);
  expect(await lookup(orgInstallation(12, 'globex'), VIEWER)).toBe(false);
  expect(github.requests).toEqual([
    'POST /app/installations/11/access_tokens',
    'GET /orgs/acme/memberships/alice',
    'POST /app/installations/12/access_tokens',
    'GET /orgs/globex/memberships/alice',
  ]);
});

test('with real tokens: installation 12 cannot see the membership of the organisation of installation 11', async () => {
  const { lookup } = await realWorld();
  expect(await lookup(orgInstallation(12, 'acme'), VIEWER)).toBe(false);
});

test.each<NotAdmittedReason>(['rejected', 'deleted', 'suspended'])(
  'an installation the instance does not serve (%s) is refused by the gate before any request',
  async (reason) => {
    const { github, lookup } = await realWorld();
    github.refuse(id(11), reason);
    await expect(lookup(orgInstallation(11, 'acme'), VIEWER)).rejects.toEqual(new InstallationNotAdmittedError(reason));
    expect(github.requests).toEqual([]);
  },
);

test('a user installation asks GitHub nothing, not even for a token', async () => {
  const { github, lookup } = await realWorld();
  expect(await lookup(userInstallation(11, VIEWER_ID), VIEWER)).toBe(true);
  expect(await lookup(userInstallation(11, VIEWER_ID + 1), VIEWER)).toBe(false);
  expect(github.requests).toEqual([]);
});
