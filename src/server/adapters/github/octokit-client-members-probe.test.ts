// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { GitHubNotFoundError, GitHubUnavailableError } from '../../services/ports/github-errors.ts';
import { clientFixture, installationJson, json, line, type Routes } from './client-fixture/test-support.ts';
import {
  MEMBERS_PROBE_ANSWERS,
  MEMBERS_PROBE_CASES,
  type MembersProbeFixture,
  type ProbeOutcome,
} from './members-probe-fixture/test-support.ts';
import { membersProbeSchema } from './schemas.ts';

// The members permission probe of the allowlist form (E14-S05) against the Octokit adapter and a mocked GitHub: every answer
// GitHub gives to `GET /orgs/{org}/members?per_page=1` (the fixtures next to the adapter), what the adapter sends, and what
// it never does (cache the answer, use the public-members endpoints, ask about an account that is no organisation).
// The mocked GitHub refuses the public-members endpoints, so a probe that used them would fail the test it is in.

const INSTALLATION = parseGithubId(11);
const OTHER_INSTALLATION = parseGithubId(12);
const APP_ROUTE = 'GET /app/installations/:id';
const MEMBERS_ROUTE = 'GET /orgs/:org/members';

/** The installation GitHub names for `githubId`: an organisation called `login`. */
const organisation = (githubId: number, login: string): Record<string, unknown> =>
  installationJson(githubId, { account: { id: githubId + 5000, login, type: 'Organization' } });

const answering = (fixture: MembersProbeFixture): Routes => ({
  [APP_ROUTE]: () => json(organisation(11, 'acme')),
  [MEMBERS_ROUTE]: () => json(fixture.response.body, fixture.response.status, fixture.response.headers),
});

/** What a probe came to, as plain data: the answer, or the name of the error it failed with. */
async function outcomeOf(probe: () => Promise<boolean>): Promise<ProbeOutcome> {
  try {
    return { returns: await probe() };
  } catch (error) {
    return { rejects: error instanceof Error ? error.name : 'not an error' };
  }
}

test.each(MEMBERS_PROBE_CASES)(
  'the adapter reads the answer "%s" of GitHub as the port promises',
  async (_name, fixture) => {
    const { client } = clientFixture(answering(fixture));
    expect(await outcomeOf(() => client.probeMembersPermission(INSTALLATION))).toEqual(fixture.port);
  },
);

test('a probe asks GitHub for the installation, then for one member of its organisation with the installation token', async () => {
  const { client, calls } = clientFixture(answering(MEMBERS_PROBE_ANSWERS.granted));
  expect(await client.probeMembersPermission(INSTALLATION)).toBe(true);
  expect(calls.map((call) => [line(call), call.headers.get('authorization')])).toEqual([
    ['GET /app/installations/11', 'Bearer made-up-jwt'],
    ['GET /orgs/acme/members?per_page=1', 'Bearer ghs_made-up-11-1'],
  ]);
  expect(calls.some((call) => call.path.includes('public_members'))).toBe(false);
});

test('the organisation is the one GitHub names now, so a renamed organisation is asked about under its new name', async () => {
  const { client, calls } = clientFixture({
    [APP_ROUTE]: () => json(organisation(11, 'acme-renamed')),
    [MEMBERS_ROUTE]: () => json(MEMBERS_PROBE_ANSWERS.granted.response.body),
  });
  expect(await client.probeMembersPermission(INSTALLATION)).toBe(true);
  expect(calls.map(line)).toEqual(['GET /app/installations/11', 'GET /orgs/acme-renamed/members?per_page=1']);
});

test('the answer is never kept: the permission is asked about again at each probe, and the answer follows it at once', async () => {
  const granted = [false, true, false];
  const { client, calls } = clientFixture({
    [APP_ROUTE]: () => json(organisation(11, 'acme')),
    [MEMBERS_ROUTE]: () => {
      const { response } = MEMBERS_PROBE_ANSWERS[granted.shift() ? 'granted' : 'missing'];
      return json(response.body, response.status, response.headers);
    },
  });
  const answers = [
    await client.probeMembersPermission(INSTALLATION),
    await client.probeMembersPermission(INSTALLATION),
    await client.probeMembersPermission(INSTALLATION),
  ];
  expect(answers).toEqual([false, true, false]);
  expect(calls.filter((call) => call.path === '/orgs/acme/members')).toHaveLength(3);
});

test('a probe is about the installation that asks and uses its token: another installation is asked about its own organisation, with its own token', async () => {
  const { client, calls } = clientFixture({
    [APP_ROUTE]: (call) => json(call.path.endsWith('/11') ? organisation(11, 'acme') : organisation(12, 'globex')),
    [MEMBERS_ROUTE]: (call) =>
      call.path === '/orgs/acme/members'
        ? json(MEMBERS_PROBE_ANSWERS.granted.response.body)
        : json(MEMBERS_PROBE_ANSWERS.missing.response.body, 403),
  });
  const answers = [
    await client.probeMembersPermission(INSTALLATION),
    await client.probeMembersPermission(OTHER_INSTALLATION),
    await client.probeMembersPermission(INSTALLATION),
  ];
  expect(answers).toEqual([true, false, true]);
  expect(
    calls
      .filter((call) => call.path.startsWith('/orgs/'))
      .map((call) => [call.path, call.headers.get('authorization')]),
  ).toEqual([
    ['/orgs/acme/members', 'Bearer ghs_made-up-11-1'],
    ['/orgs/globex/members', 'Bearer ghs_made-up-12-1'],
    ['/orgs/acme/members', 'Bearer ghs_made-up-11-1'],
  ]);
  expect(calls.filter((call) => call.path.startsWith('/app/')).map((call) => call.path)).toEqual([
    '/app/installations/11',
    '/app/installations/12',
    '/app/installations/11',
  ]);
});

test.each([
  ['an installation of a user', installationJson(11, { account: { id: 5011, login: 'ada', type: 'User' } })],
  ['an installation of an enterprise account', installationJson(11, { account: { id: 5011, slug: 'big-corp' } })],
  ['an organisation whose login GitHub cannot hold', organisation(11, '../orgs/other')],
])(
  '%s has no organisation to ask about: the probe is a GitHubNotFoundError and no members are asked for',
  async (_name, body) => {
    const { client, calls } = clientFixture({ [APP_ROUTE]: () => json(body) });
    await expect(client.probeMembersPermission(INSTALLATION)).rejects.toBeInstanceOf(GitHubNotFoundError);
    expect(calls.map(line)).toEqual(['GET /app/installations/11']);
  },
);

test('an installation GitHub no longer has is a GitHubNotFoundError too, and no members are asked for', async () => {
  const { client, calls } = clientFixture({ [APP_ROUTE]: () => json({ message: 'Not Found' }, 404) });
  await expect(client.probeMembersPermission(INSTALLATION)).rejects.toBeInstanceOf(GitHubNotFoundError);
  expect(calls.map(line)).toEqual(['GET /app/installations/11']);
});

const SLOW = async () => {
  await new Promise((resolve) => setTimeout(resolve, 400));
  return json(MEMBERS_PROBE_ANSWERS.granted.response.body);
};

test.each([
  ['a 500', () => json({ message: 'boom' }, 500), 1, 5000],
  ['a 503, repeated twice by the adapter', () => json({ message: 'down' }, 503), 3, 5000],
  ['a connection that fails', () => Response.error(), 3, 5000],
  ['an answer later than the timeout', SLOW, 3, 30],
])(
  '%s is an outage: the probe fails with GitHubUnavailableError after %i attempt(s)',
  async (_name, answer, attempts, timeoutMs) => {
    const { client, calls } = clientFixture(
      { [APP_ROUTE]: () => json(organisation(11, 'acme')), [MEMBERS_ROUTE]: answer },
      { timeoutMs },
    );
    await expect(client.probeMembersPermission(INSTALLATION)).rejects.toBeInstanceOf(GitHubUnavailableError);
    expect(calls.filter((call) => call.path === '/orgs/acme/members')).toHaveLength(attempts);
  },
);

test('the schema reads a list of accounts by their numeric ids and keeps no login of a member', () => {
  expect(membersProbeSchema.parse([{ id: 501, login: 'zzzz-ada', type: 'User' }])).toEqual([{ id: 501 }]);
  expect(membersProbeSchema.parse([])).toEqual([]);
});

test.each([
  ['an object', { members: [] }],
  ['a list of names', ['alice']],
  ['a member with no id', [{ login: 'alice' }]],
  ['a member whose id is not a positive integer', [{ id: 0 }]],
])('the schema refuses %s', (_name, body) => {
  expect(membersProbeSchema.safeParse(body).success).toBe(false);
});
