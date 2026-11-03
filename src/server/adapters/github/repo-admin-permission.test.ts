// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { afterEach, expect, test, vi } from 'vitest';
import { testGitHubKey } from '../../config/test-support.ts';
import { id, installation } from '../../services/github-contract/test-support.ts';
import {
  GitHubRateLimitedError,
  GitHubUnavailableError,
  InstallationNotAdmittedError,
  type NotAdmittedReason,
} from '../../services/ports/github-errors.ts';
import { createRepoAdminLookup } from '../../services/repo-admin.ts';
import {
  eventsOf,
  installationRow,
  storedRepository,
  VIEWER,
  VIEWER_ID,
} from '../../services/role-fixture/test-support.ts';
import { createLogger } from '../http/logger.ts';
import { clientFixture, json, line, type RouteAnswer, type Routes } from './client-fixture/test-support.ts';
import { httpWorld } from './http-world/test-support.ts';
import { PERMISSION_FIXTURES } from './permission-fixture/test-support.ts';
import { START } from './test-support.ts';

// The repository admin role fact (E11-S03) over the real Octokit adapter: MSW answers the fixtures of the permission call
// and the lookup reads them through the adapter's own schema, rate limiter, token provider and error classes.

const PERMISSION = 'GET /repos/:owner/:repo/collaborators/:username/permission';
const PERMISSION_LINE = 'GET /repos/acme/api/collaborators/alice/permission';

const ACME_INSTALLATION = installationRow(11);
const API = storedRepository('acme/api');

/** The adapter and the lookup over `routes`. */
function world(routes: Routes, options: Parameters<typeof clientFixture>[1] = {}) {
  const fixture = clientFixture(routes, options);
  const log = createLogger({ logLevel: 'info' }, fixture.logs.destination);
  return {
    ...fixture,
    requests: () => fixture.calls.map(line),
    lookup: createRepoAdminLookup({ github: fixture.client, log }),
  };
}

const failureOf = (promise: Promise<unknown>): Promise<unknown> => promise.catch((error: unknown) => error);

const warnings = (fixture: ReturnType<typeof world>) =>
  fixture.logs.lines().filter((each) => each['msg'] === 'repository_permission_missing');

test.each(PERMISSION_FIXTURES)('the adapter reads $name as the port promises', async ({ answer, port }) => {
  const { client, requests } = world({ [PERMISSION]: answer });
  const result = client.getRepositoryPermission(id(11), 'acme', 'api', 'alice');
  if ('returns' in port) {
    expect(await result).toStrictEqual(port.returns);
  } else {
    await expect(result).rejects.toBeInstanceOf(port.throws);
  }
  expect(requests()).toEqual([PERMISSION_LINE]);
});

test.each(PERMISSION_FIXTURES)('the repository admin lookup reads $name', async ({ answer, lookup: expected }) => {
  const fixture = world({ [PERMISSION]: answer });
  const outcome = await failureOf(fixture.lookup(ACME_INSTALLATION, API, VIEWER));
  if ('limitedForSeconds' in expected) {
    expect(outcome).toBeInstanceOf(GitHubRateLimitedError);
    expect(outcome).toMatchObject({ retryAfterSeconds: expected.limitedForSeconds, scope: 'primary' });
    expect(fixture.waits).toEqual([]);
  } else {
    expect(outcome).toBe(expected.admin);
    expect(warnings(fixture)).toHaveLength(expected.permissionMissing ? 1 : 0);
  }
  expect(fixture.requests()).toEqual([PERMISSION_LINE]);
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
  const fixture = world({ [PERMISSION]: () => json({ message: 'Forbidden' }, 403, headers) });
  const failure = await failureOf(fixture.lookup(ACME_INSTALLATION, API, VIEWER));
  expect(failure).toBeInstanceOf(GitHubRateLimitedError);
  expect(failure).toMatchObject({ retryAfterSeconds: seconds, scope });
  expect(fixture.waits).toEqual([]);
  expect(warnings(fixture)).toEqual([]);
});

afterEach(() => {
  vi.useRealTimers();
});

test('the 403 that is a missing permission logs the numeric installation id and nothing of the person or the repository', async () => {
  // A clock whose milliseconds spell the viewer's id: the line's own `time` must not look like a leak of the id.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-02T20:01:25.501Z'));
  const fixture = world({ [PERMISSION]: () => json({ message: 'Resource not accessible by integration' }, 403) });
  expect(await fixture.lookup(ACME_INSTALLATION, API, VIEWER)).toBe(false);
  expect(warnings(fixture)).toHaveLength(1);
  expect(warnings(fixture)[0]).toMatchObject({ level: 40 });
  expect(eventsOf(warnings(fixture))).toEqual([{ githubInstallationId: 11, msg: 'repository_permission_missing' }]);
  expect(JSON.stringify(eventsOf(warnings(fixture)))).not.toMatch(/alice|acme|501/);
});

test.each([
  ['an owner with a slash', 'acme/../orgs/api', VIEWER],
  ['a repository name that climbs out of the path', 'acme/..', VIEWER],
  ['a login that climbs out of the path', 'acme/api', { githubId: VIEWER_ID, login: '../app' }],
  ['an empty login', 'acme/api', { githubId: VIEWER_ID, login: '' }],
])('%s is not an admin and no permission request is sent for it', async (_name, fullName, viewer) => {
  const fixture = world({
    [PERMISSION]: () => json({ permission: 'admin', role_name: 'admin', user: { login: 'alice', id: VIEWER_ID } }),
  });
  expect(await fixture.lookup(ACME_INSTALLATION, storedRepository(fullName), viewer)).toBe(false);
  expect(fixture.requests()).toEqual([]);
});

test('a repository that is removed is never probed', async () => {
  const fixture = world({
    [PERMISSION]: () => json({ permission: 'admin', role_name: 'admin', user: { login: 'alice', id: VIEWER_ID } }),
  });
  expect(await fixture.lookup(ACME_INSTALLATION, storedRepository('acme/api', new Date(START)), VIEWER)).toBe(false);
  expect(fixture.requests()).toEqual([]);
});

/** An answer that changes with the installation whose token asked, as GitHub's does: the viewer is an admin of 11 only. */
const byToken: RouteAnswer = (call) =>
  json({
    permission: call.headers.get('authorization') === 'Bearer ghs_made-up-11-1' ? 'admin' : 'write',
    role_name: 'admin',
    user: { login: 'alice', id: VIEWER_ID },
  });

test('the same viewer is admin of a repository of installation 11 and a writer on one of installation 12: each lookup carries its own installation token', async () => {
  const fixture = world({ [PERMISSION]: byToken });
  expect(await fixture.lookup(installationRow(11), storedRepository('acme/api'), VIEWER)).toBe(true);
  expect(await fixture.lookup(installationRow(12), storedRepository('globex/api'), VIEWER)).toBe(false);
  expect(fixture.requests()).toEqual([
    'GET /repos/acme/api/collaborators/alice/permission',
    'GET /repos/globex/api/collaborators/alice/permission',
  ]);
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
  const fixture = world({ [PERMISSION]: answer });
  expect(await failureOf(fixture.lookup(ACME_INSTALLATION, API, VIEWER))).toBeInstanceOf(GitHubUnavailableError);
  expect([fixture.requests().length, fixture.waits]).toEqual([requestsMade, waits]);
});

test('an answer slower than the request timeout is an outage', async () => {
  // An answer that never comes, and a timeout long enough for the connection to be made first: a timeout of 30 ms that fires
  // in the middle of the TLS handshake leaves a handshake that ends after the test, and the runner reports its error
  // (an unhandled ERR_TLS_CERT_ALTNAME_INVALID) against whichever test runs next.
  const slow = () => new Promise<Response>(() => undefined);
  const fixture = world({ [PERMISSION]: slow }, { timeoutMs: 1000 });
  expect(await failureOf(fixture.lookup(ACME_INSTALLATION, API, VIEWER))).toBeInstanceOf(GitHubUnavailableError);
});

const signer = testGitHubKey();

/** The whole chain: the token provider mints per installation, MSW answers each token with what that installation sees. */
async function realWorld() {
  const github = await httpWorld(signer);
  github.addInstallation(installation(11, 'acme'));
  github.addInstallation(installation(12, 'globex'));
  github.addRepositoryPermission(id(11), 'acme/api', 'alice', { permission: 'admin', userId: VIEWER_ID });
  github.addRepositoryPermission(id(12), 'globex/api', 'alice', { permission: 'write', userId: VIEWER_ID });
  const log = createLogger({ logLevel: 'info' }, { write: () => undefined });
  return { github, lookup: createRepoAdminLookup({ github: github.client, log }) };
}

test('with real tokens: admin of installation 11, a writer on installation 12, and each token sees only its own installation', async () => {
  const { github, lookup } = await realWorld();
  expect(await lookup(installationRow(11), storedRepository('acme/api'), VIEWER)).toBe(true);
  expect(await lookup(installationRow(12), storedRepository('globex/api'), VIEWER)).toBe(false);
  expect(github.requests).toEqual([
    'POST /app/installations/11/access_tokens',
    'GET /repos/acme/api/collaborators/alice/permission',
    'POST /app/installations/12/access_tokens',
    'GET /repos/globex/api/collaborators/alice/permission',
  ]);
});

test('with real tokens: installation 12 cannot see the permission on a repository of installation 11', async () => {
  const { lookup } = await realWorld();
  expect(await lookup(installationRow(12), storedRepository('acme/api'), VIEWER)).toBe(false);
});

test('with real tokens: a repository that was renamed since the last sync is a 404 and a denial', async () => {
  const { github, lookup } = await realWorld();
  github.addRepositoryPermission(id(11), 'acme/api-renamed', 'alice', { permission: 'admin', userId: VIEWER_ID });
  expect(await lookup(installationRow(11), storedRepository('acme/api-old-name'), VIEWER)).toBe(false);
  expect(await lookup(installationRow(11), storedRepository('acme/api-renamed'), VIEWER)).toBe(true);
});

test.each<NotAdmittedReason>(['rejected', 'deleted', 'suspended'])(
  'an installation the instance does not serve (%s) is refused by the gate before any request',
  async (reason) => {
    const { github, lookup } = await realWorld();
    github.refuse(id(11), reason);
    await expect(lookup(installationRow(11), storedRepository('acme/api'), VIEWER)).rejects.toEqual(
      new InstallationNotAdmittedError(reason),
    );
    expect(github.requests).toEqual([]);
  },
);
