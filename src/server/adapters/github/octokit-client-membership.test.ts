// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { createOrgMembership } from '../../services/org-membership.ts';
import { createOrgMembershipCache } from '../../services/org-membership-cache.ts';
import {
  GitHubForbiddenError,
  GitHubRateLimitedError,
  GitHubUnavailableError,
} from '../../services/ports/github-errors.ts';
import { captureLogs } from '../../test-support.ts';
import { migratedTestDatabase, seedTenant } from '../db/test-support.ts';
import { createLogger } from '../http/logger.ts';
import { type ClientFixture, clientFixture, json, type Routes } from './client-fixture/test-support.ts';
import {
  ALICE,
  MEMBERSHIP_BODIES,
  MEMBERSHIP_CASES,
  MEMBERSHIP_FIXTURES,
  type MembershipFixture,
  type Outcome,
} from './exemption-fixture/test-support.ts';
import { orgMembershipSchema } from './schemas.ts';

// The membership lookup of the evaluation job against the Octokit adapter and a mocked GitHub (E07-S10): every answer GitHub
// gives to `GET /orgs/{org}/memberships/{username}` (the fixtures next to the adapter), read by the adapter and then by the
// service that decides who is exempt. The mocked GitHub refuses the public-members endpoints, so a lookup that used them would fail.

const ROUTE = 'GET /orgs/:org/memberships/:username';
const INSTALLATION = parseGithubId(5000);
const OTHER_INSTALLATION = parseGithubId(10_000);

/** What a promise produced, as plain data: its value, or the one of the errors the lookup is allowed to fail with. */
async function outcomeOf<T>(run: () => Promise<T>): Promise<Outcome<T>> {
  try {
    return { returned: await run() };
  } catch (error) {
    if (error instanceof GitHubForbiddenError) {
      return { rejected: 'GitHubForbiddenError' };
    }
    if (error instanceof GitHubRateLimitedError) {
      return { rejected: 'GitHubRateLimitedError', retryAfterSeconds: error.retryAfterSeconds, scope: error.scope };
    }
    throw error;
  }
}

const answering = (fixture: MembershipFixture): Routes => ({
  [ROUTE]: () => json(fixture.body, fixture.status, fixture.headers),
});

/** The service over the adapter of `github`, with the tenants 1 and 2 stored, a cache on the clock of the fixture and a log of its own. */
async function serviceOver(github: ClientFixture) {
  const { db } = await migratedTestDatabase();
  await seedTenant(db, 1);
  await seedTenant(db, 2);
  const logs = captureLogs();
  const service = createOrgMembership({
    db,
    github: github.client,
    logger: createLogger({ logLevel: 'info' }, logs.destination),
    cache: createOrgMembershipCache(github.clock),
  });
  const ask = (githubInstallationId = INSTALLATION) =>
    service.isOrgMember({ githubInstallationId, userGithubId: parseGithubId(ALICE.id), login: ALICE.login });
  return { ask, logs, paths: () => github.calls.map((call) => call.path) };
}

test.each(MEMBERSHIP_CASES)(
  'the adapter reads the answer "%s" of GitHub as the port promises',
  async (_name, fixture) => {
    const { client } = clientFixture(answering(fixture));
    expect(await outcomeOf(() => client.getOrgMembership(parseGithubId(11), 'acme', ALICE.login))).toEqual(
      fixture.adapter,
    );
  },
);

test.each(MEMBERSHIP_BODIES)(
  'the body of "%s" is something the schema reads, and it keeps the state, the role and the id only',
  (_name, body) => {
    const read = orgMembershipSchema.parse(body);
    expect(read).toEqual({ state: body.state, role: body.role, userId: body.user.id });
    expect(Object.keys(read)).toEqual(['state', 'role', 'userId']);
  },
);

test.each(MEMBERSHIP_CASES)(
  'the service turns the answer "%s" into its verdict, and says so in the log only for a missing permission',
  async (name, fixture) => {
    const { ask, logs } = await serviceOver(clientFixture(answering(fixture)));
    expect(await outcomeOf(ask)).toEqual(fixture.service);
    const warned = logs.lines().filter((line) => line['msg'] === 'members_permission_missing');
    expect(warned).toEqual(
      name === 'permission' ? [expect.objectContaining({ level: 40, githubInstallationId: 5000 })] : [],
    );
    expect(logs.text()).not.toContain(ALICE.login);
  },
);

// The adapter's own rate limiter holds the lane of an installation back while a limit lasts, so the second question of a
// limited installation is answered with the same error without a request: either way nothing was kept as an answer.
test.each([
  ['active', MEMBERSHIP_FIXTURES.active, 1],
  ['pending', MEMBERSHIP_FIXTURES.pending, 1],
  ['idMismatch', MEMBERSHIP_FIXTURES.idMismatch, 1],
  ['notFound', MEMBERSHIP_FIXTURES.notFound, 1],
  ['permission', MEMBERSHIP_FIXTURES.permission, 2],
  ['retryAfter', MEMBERSHIP_FIXTURES.retryAfter, 1],
  ['exhausted', MEMBERSHIP_FIXTURES.exhausted, 1],
])(
  'the answer "%s" costs %i request(s) for two questions, and both are answered alike: only a verdict is kept',
  async (_name, fixture, requests) => {
    const { ask, paths } = await serviceOver(clientFixture(answering(fixture)));
    const asked = [await outcomeOf(ask), await outcomeOf(ask)];
    expect(asked).toEqual([fixture.service, fixture.service]);
    expect(paths()).toHaveLength(requests);
  },
);

const SLOW = async () => {
  await new Promise((resolve) => setTimeout(resolve, 400));
  return json(MEMBERSHIP_FIXTURES.active.body);
};

test.each([
  ['a 500', () => json({ message: 'boom' }, 500), 1, 5000],
  ['a 503, repeated twice by the adapter', () => json({ message: 'down' }, 503), 3, 5000],
  ['a connection that fails', () => Response.error(), 3, 5000],
  ['an answer later than the timeout', SLOW, 3, 30],
])(
  '%s is an outage: the lookup fails with GitHubUnavailableError and nothing is kept',
  async (_name, answer, attempts, timeoutMs) => {
    const { ask, paths } = await serviceOver(clientFixture({ [ROUTE]: answer }, { timeoutMs }));
    await expect(ask()).rejects.toBeInstanceOf(GitHubUnavailableError);
    await expect(ask()).rejects.toBeInstanceOf(GitHubUnavailableError);
    expect(paths()).toHaveLength(2 * attempts);
  },
);

test('a member of one installation is asked about afresh in another, where she is a stranger, with the token of the installation that asks', async () => {
  const member = () => json(MEMBERSHIP_FIXTURES.active.body);
  const github = clientFixture({
    [ROUTE]: (call) => (call.path.startsWith('/orgs/org-1/') ? member() : json({ message: 'Not Found' }, 404)),
  });
  const { ask } = await serviceOver(github);
  expect(await ask(INSTALLATION)).toBe('member');
  expect(await ask(OTHER_INSTALLATION)).toBe('not_member');
  expect(await ask(INSTALLATION)).toBe('member');
  expect(await ask(OTHER_INSTALLATION)).toBe('not_member');
  const { calls } = github;
  expect(calls.map((call) => [call.path, call.headers.get('authorization')])).toEqual([
    ['/orgs/org-1/memberships/alice', 'Bearer ghs_made-up-5000-1'],
    ['/orgs/org-2/memberships/alice', 'Bearer ghs_made-up-10000-1'],
  ]);
  expect(calls.some((call) => call.path.includes('public_members'))).toBe(false);
});
