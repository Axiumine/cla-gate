// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import type { GitHubUserAccount } from '../../services/ports/github.ts';
import { GitHubUnavailableError } from '../../services/ports/github-errors.ts';
import { clientFixture, json, line } from './client-fixture/test-support.ts';
import {
  ADA_FOUND,
  accountBody,
  USER_ACCOUNT_CASES,
  type UserAccountFixture,
} from './user-account-fixture/test-support.ts';
import { userAccountSchema } from './user-account-schema.ts';

// The lookup of an account by login for the allowlist form (E14-S06) against the Octokit adapter and a mocked GitHub: every answer
// GitHub gives to `GET /users/{username}` (the fixtures next to the adapter), what the adapter sends (the login percent-encoded,
// the installation's own token), and what it never does (send a login that cannot be one, hand a snapshot with markup on).

const INSTALLATION = parseGithubId(11);
const OTHER_INSTALLATION = parseGithubId(12);
const ACCOUNT_ROUTE = 'GET /users/:login';

const answering = (fixture: UserAccountFixture) => ({
  [ACCOUNT_ROUTE]: () => json(fixture.response.body, fixture.response.status, fixture.response.headers),
});

/** What a lookup came to, as plain data: the account, or the name of the error it failed with. */
async function outcomeOf(lookup: () => Promise<GitHubUserAccount | null>) {
  try {
    return { returns: await lookup() };
  } catch (error) {
    return { rejects: error instanceof Error ? error.name : 'not an error' };
  }
}

test.each(USER_ACCOUNT_CASES)(
  'the adapter reads the answer "%s" of GitHub as the port promises',
  async (_name, fixture) => {
    const { client } = clientFixture(answering(fixture));
    expect(await outcomeOf(() => client.getUserAccount(INSTALLATION, 'ada'))).toEqual(fixture.port);
  },
);

test('a lookup asks GitHub for the login, once, with the token of the installation that asks', async () => {
  const { client, calls } = clientFixture(answering(ADA_FOUND));
  expect(await client.getUserAccount(INSTALLATION, 'ada')).toEqual({ id: 501, login: 'ada', type: 'User' });
  expect(calls.map((call) => [line(call), call.headers.get('authorization')])).toEqual([
    ['GET /users/ada', 'Bearer ghs_made-up-11-1'],
  ]);
});

test('the login goes out percent-encoded, so the brackets of a bot never reach the path raw', async () => {
  const { client, calls } = clientFixture({
    [ACCOUNT_ROUTE]: () => json(accountBody({ id: 49_699_333, login: 'dependabot[bot]', type: 'Bot' })),
  });
  expect(await client.getUserAccount(INSTALLATION, 'dependabot[bot]')).toEqual({
    id: 49_699_333,
    login: 'dependabot[bot]',
    type: 'Bot',
  });
  expect(calls.map(line)).toEqual(['GET /users/dependabot%5Bbot%5D']);
});

test.each([
  ['a path walk', '../orgs/acme'],
  ['a slash', 'ada/lovelace'],
  ['a query', 'ada?per_page=1'],
  ['markup', '<b>ada</b>'],
  ['a space', 'ada lovelace'],
  ['an underscore', 'ada_lovelace'],
  ['40 characters', `a${'b'.repeat(39)}`],
  ['a leading hyphen', '-ada'],
  ['an empty login', ''],
])('%s is no login: the lookup is null and nothing is sent', async (_name, login) => {
  const { client, calls } = clientFixture(answering(ADA_FOUND));
  expect(await client.getUserAccount(INSTALLATION, login)).toBeNull();
  expect(calls).toEqual([]);
});

test('each installation asks with its own token, and an account is found whichever installation holds it', async () => {
  const { client, calls } = clientFixture({
    [ACCOUNT_ROUTE]: () => json(accountBody({ id: 501, login: 'ada', type: 'User' })),
  });
  await client.getUserAccount(INSTALLATION, 'ada');
  await client.getUserAccount(OTHER_INSTALLATION, 'ada');
  await client.getUserAccount(INSTALLATION, 'ada');
  expect(calls.map((call) => call.headers.get('authorization'))).toEqual([
    'Bearer ghs_made-up-11-1',
    'Bearer ghs_made-up-12-1',
    'Bearer ghs_made-up-11-1',
  ]);
});

const SLOW = async () => {
  await new Promise((resolve) => setTimeout(resolve, 400));
  return json(accountBody({ id: 501, login: 'ada', type: 'User' }));
};

test.each([
  ['a 500', () => json({ message: 'boom' }, 500), 1, 5000],
  ['a 503, repeated twice by the adapter', () => json({ message: 'down' }, 503), 3, 5000],
  ['a connection that fails', () => Response.error(), 3, 5000],
  ['an answer later than the timeout', SLOW, 3, 30],
])(
  '%s is an outage: the lookup fails with GitHubUnavailableError after %i attempt(s)',
  async (_name, answer, attempts, timeoutMs) => {
    const { client, calls } = clientFixture({ [ACCOUNT_ROUTE]: answer }, { timeoutMs });
    await expect(client.getUserAccount(INSTALLATION, 'ada')).rejects.toBeInstanceOf(GitHubUnavailableError);
    expect(calls).toHaveLength(attempts);
  },
);

test('the schema keeps the id, the login and the type and nothing else of an account', () => {
  const body = accountBody({ id: 501, login: 'ada', type: 'User' });
  expect(userAccountSchema.parse({ ...body, email: 'zzzz@example.test', name: 'Zzzz' })).toEqual({
    id: 501,
    login: 'ada',
    type: 'User',
  });
});

test.each([
  ['no id', { login: 'ada', type: 'User' }],
  ['an id of zero', { id: 0, login: 'ada', type: 'User' }],
  ['a negative id', { id: -3, login: 'ada', type: 'User' }],
  ['an id past what a number holds exactly', { id: 2 ** 60, login: 'ada', type: 'User' }],
  ['no login', { id: 1, type: 'User' }],
  ['a login with a quote', { id: 1, login: 'ada"onload="x', type: 'User' }],
  ['a login with a script', { id: 1, login: '<script>x</script>', type: 'User' }],
  ['a login with a newline', { id: 1, login: 'ada\n', type: 'User' }],
  ['a login of 45 characters', { id: 1, login: 'a'.repeat(45), type: 'User' }],
  ['no type', { id: 1, login: 'ada' }],
  ['a type that is not text', { id: 1, login: 'ada', type: 7 }],
])('the schema refuses %s', (_name, body) => {
  expect(userAccountSchema.safeParse(body).success).toBe(false);
});
