// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import {
  GitHubForbiddenError,
  GitHubRateLimitedError,
  GitHubUnavailableError,
} from '../../services/ports/github-errors.ts';
import { clientFixture, json, line } from './client-fixture/test-support.ts';
import { accountBody } from './user-account-fixture/test-support.ts';

// The lookup of an organisation by login for the corporate approvals (E21-S03) against the Octokit adapter and a mocked GitHub: what the
// adapter sends (the login percent-encoded, the installation's own token, nothing for a login that cannot be an organisation's) and what it
// makes of each answer of `GET /orgs/{org}`.

const INSTALLATION = parseGithubId(11);
const ORG_ROUTE = 'GET /orgs/:org';
const GLOBEX = accountBody({ id: 9001, login: 'Globex', type: 'Organization' });

test('a lookup asks GitHub for the organisation, once, with the token of the installation that asks', async () => {
  const { client, calls } = clientFixture({ [ORG_ROUTE]: () => json(GLOBEX) });
  expect(await client.getOrganizationAccount(INSTALLATION, 'globex')).toEqual({
    id: 9001,
    login: 'Globex',
    type: 'Organization',
  });
  expect(calls.map((call) => [line(call), call.headers.get('authorization')])).toEqual([
    ['GET /orgs/globex', 'Bearer ghs_made-up-11-1'],
  ]);
});

test('a 404 is no such organisation, which is also what GitHub answers for the login of a person', async () => {
  const { client } = clientFixture({ [ORG_ROUTE]: () => json({ message: 'Not Found' }, 404) });
  expect(await client.getOrganizationAccount(INSTALLATION, 'ada')).toBeNull();
});

test.each([
  ['a path walk', '../orgs/acme'],
  ['a slash', 'acme/corp'],
  ['a query', 'acme?per_page=1'],
  ['markup', '<b>acme</b>'],
  ['a space', 'acme corp'],
  ['the suffix of a bot', 'acme[bot]'],
  ['40 characters', `a${'b'.repeat(39)}`],
  ['a leading hyphen', '-acme'],
  ['an empty login', ''],
])('%s is no organisation: the lookup is null and nothing is sent', async (_name, login) => {
  const { client, calls } = clientFixture({ [ORG_ROUTE]: () => json(GLOBEX) });
  expect(await client.getOrganizationAccount(INSTALLATION, login)).toBeNull();
  expect(calls).toEqual([]);
});

test.each([
  [
    'a rate limit',
    () => json({ message: 'API rate limit exceeded' }, 403, { 'x-ratelimit-remaining': '0', 'retry-after': '120' }),
    GitHubRateLimitedError,
  ],
  ['a plain 403', () => json({ message: 'Forbidden' }, 403), GitHubForbiddenError],
  ['a 500', () => json({ message: 'boom' }, 500), GitHubUnavailableError],
])('%s is told as the error of the port', async (_name, answer, error) => {
  const { client } = clientFixture({ [ORG_ROUTE]: answer });
  await expect(client.getOrganizationAccount(INSTALLATION, 'acme')).rejects.toBeInstanceOf(error);
});
