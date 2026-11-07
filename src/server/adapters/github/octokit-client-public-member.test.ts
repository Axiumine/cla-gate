// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import {
  GitHubForbiddenError,
  GitHubRateLimitedError,
  GitHubResponseError,
  GitHubUnavailableError,
} from '../../services/ports/github-errors.ts';
import { clientFixture, json, line } from './client-fixture/test-support.ts';

// The check of a public membership for the claim under a corporate agreement (E21-S04) against the Octokit adapter and a mocked GitHub: what
// the adapter sends (the two names percent-encoded, the installation's own token, nothing for names that cannot be an organisation and a
// login) and what it makes of each answer of `GET /orgs/{org}/public_members/{username}`, where only a 204 is a member.

const INSTALLATION = parseGithubId(11);
const OTHER_INSTALLATION = parseGithubId(12);
const MEMBER_ROUTE = 'GET /orgs/:org/public_members/:username';
const MEMBER = () => new Response(null, { status: 204 });

test('a check asks GitHub for the pair, once, with the token of the installation that asks', async () => {
  const { client, calls } = clientFixture({ [MEMBER_ROUTE]: MEMBER });
  expect(await client.isPublicOrgMember(INSTALLATION, 'globex', 'ada')).toBe(true);
  expect(calls.map((call) => [line(call), call.headers.get('authorization')])).toEqual([
    ['GET /orgs/globex/public_members/ada', 'Bearer ghs_made-up-11-1'],
  ]);
});

test('each installation asks with its own token', async () => {
  const { client, calls } = clientFixture({ [MEMBER_ROUTE]: MEMBER });
  await client.isPublicOrgMember(INSTALLATION, 'globex', 'ada');
  await client.isPublicOrgMember(OTHER_INSTALLATION, 'globex', 'ada');
  expect(calls.map((call) => call.headers.get('authorization'))).toEqual([
    'Bearer ghs_made-up-11-1',
    'Bearer ghs_made-up-12-1',
  ]);
});

test('a 404 is no public membership: the person is not a member, or does not show it', async () => {
  const { client } = clientFixture({ [MEMBER_ROUTE]: () => json({ message: 'Not Found' }, 404) });
  expect(await client.isPublicOrgMember(INSTALLATION, 'globex', 'ada')).toBe(false);
});

test.each([
  ['a 200 with a body', () => json({ login: 'ada' })],
  ['a 200 without a body', () => new Response(null, { status: 200 })],
  ['a 202', () => new Response(null, { status: 202 })],
])('%s is not what GitHub answers to a member: the check fails with GitHubResponseError', async (_name, answer) => {
  const { client } = clientFixture({ [MEMBER_ROUTE]: answer });
  await expect(client.isPublicOrgMember(INSTALLATION, 'globex', 'ada')).rejects.toBeInstanceOf(GitHubResponseError);
});

test.each([
  ['a path walk in the organisation', '../orgs/acme', 'ada'],
  ['a slash in the organisation', 'acme/corp', 'ada'],
  ['markup in the organisation', '<b>acme</b>', 'ada'],
  ['a space in the organisation', 'acme corp', 'ada'],
  ['a leading hyphen in the organisation', '-acme', 'ada'],
  ['an empty organisation', '', 'ada'],
  ['a path walk in the login', 'globex', '../app'],
  ['a query in the login', 'globex', 'ada?per_page=1'],
  ['markup in the login', 'globex', '<b>ada</b>'],
  ['a space in the login', 'globex', 'ada lovelace'],
  ['an empty login', 'globex', ''],
])('%s is no pair of names: the check is false and nothing is sent', async (_name, org, login) => {
  const { client, calls } = clientFixture({ [MEMBER_ROUTE]: MEMBER });
  expect(await client.isPublicOrgMember(INSTALLATION, org, login)).toBe(false);
  expect(calls).toEqual([]);
});

test.each([
  [
    'a rate limit',
    () => json({ message: 'API rate limit exceeded' }, 403, { 'x-ratelimit-remaining': '0', 'retry-after': '120' }),
    GitHubRateLimitedError,
  ],
  ['a plain 403', () => json({ message: 'Forbidden' }, 403), GitHubForbiddenError],
])('%s fails the check with its own error and is never read as "not a member"', async (_name, answer, error) => {
  const { client } = clientFixture({ [MEMBER_ROUTE]: answer });
  await expect(client.isPublicOrgMember(INSTALLATION, 'globex', 'ada')).rejects.toBeInstanceOf(error);
});

test.each([
  ['a 500', () => json({ message: 'boom' }, 500), 1],
  ['a 503, repeated twice by the adapter', () => json({ message: 'down' }, 503), 3],
  ['a connection that fails', () => Response.error(), 3],
])(
  '%s is an outage: the check fails with GitHubUnavailableError after %i attempt(s)',
  async (_name, answer, attempts) => {
    const { client, calls } = clientFixture({ [MEMBER_ROUTE]: answer }, { timeoutMs: 5000 });
    await expect(client.isPublicOrgMember(INSTALLATION, 'globex', 'ada')).rejects.toBeInstanceOf(
      GitHubUnavailableError,
    );
    expect(calls).toHaveLength(attempts);
  },
);
