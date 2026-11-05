// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { HttpResponse, http } from 'msw';
import type { z } from 'zod';
import type {
  UserAccountAnswer,
  UserAccountFailure,
  UserAccounts,
} from '../../../services/fake-user-accounts/test-support.ts';
import { GITHUB_API_ORIGIN } from '../github-http.ts';
import type { userAccountSchema } from '../user-account-schema.ts';

// The contract fixtures of `GET /users/{username}` (E14-S06): what GitHub answers to the lookup of an account by login, as the HTTP
// boundary sees it, and what the adapter makes of each answer. The 200 bodies are typed through the zod schema the adapter reads
// them with, so a fixture the schema would refuse does not compile. They serve the adapter test with a mocked GitHub
// (`octokit-client-user-account.test.ts`) and the HTTP world of the contract suite, which runs the same cases against `FakeGitHub`
// (`services/github-user-account-contract`).

/** The fields of an answer the adapter reads, spelled as GitHub spells them. */
export type AccountFields = z.input<typeof userAccountSchema>;

/** An account as GitHub sends it: the fields the schema reads, and the ones the platform ignores. */
export function accountBody(fields: AccountFields): Record<string, unknown> {
  return { node_id: 'MDQ6VXNlcjU=', avatar_url: 'https://avatars.example.test/u/1', site_admin: false, ...fields };
}

/** An answer of GitHub: its status, headers and JSON body. */
interface UserAccountResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: object;
}

/** What the port does with an answer: resolves this, or rejects with the error of this name. */
type LookupOutcome =
  | { readonly returns: { readonly id: number; readonly login: string; readonly type: string } | null }
  | { readonly rejects: string };

export interface UserAccountFixture {
  readonly response: UserAccountResponse;
  readonly port: LookupOutcome;
}

const reply = (status: number, body: object, headers: Record<string, string> = {}): UserAccountResponse => ({
  status,
  headers,
  body,
});

/** The three failures a test of the contract can script (`UserAccountFailure`). */
const FAILURES: Readonly<Record<UserAccountFailure, UserAccountFixture>> = {
  rate_limited: {
    response: reply(
      403,
      { message: 'API rate limit exceeded' },
      { 'x-ratelimit-remaining': '0', 'retry-after': '120' },
    ),
    port: { rejects: 'GitHubRateLimitedError' },
  },
  unavailable: { response: reply(500, { message: 'Server Error' }), port: { rejects: 'GitHubUnavailableError' } },
  malformed: { response: reply(200, { message: 'not an account' }), port: { rejects: 'GitHubResponseError' } },
};

/** The fixture of a failure a test of the contract scripted. */
function failureOf(failure: UserAccountFailure): UserAccountFixture {
  switch (failure) {
    case 'rate_limited':
      return FAILURES.rate_limited;
    case 'unavailable':
      return FAILURES.unavailable;
    case 'malformed':
      return FAILURES.malformed;
  }
}

/** GitHub's answer for the user `ada`, the one the tests that need a plain answer use. */
export const ADA_FOUND: UserAccountFixture = {
  response: reply(200, accountBody({ id: 501, login: 'ada', type: 'User' })),
  port: { returns: { id: 501, login: 'ada', type: 'User' } },
};

/** The answers of GitHub to a lookup, for the adapter test: each with the name it is shown under. */
export const USER_ACCOUNT_CASES: readonly (readonly [name: string, fixture: UserAccountFixture])[] = [
  ...Object.entries(FAILURES),
  ['a user', ADA_FOUND],
  [
    'a bot',
    {
      response: reply(200, accountBody({ id: 49_699_333, login: 'dependabot[bot]', type: 'Bot' })),
      port: { returns: { id: 49_699_333, login: 'dependabot[bot]', type: 'Bot' } },
    },
  ],
  [
    'an organisation',
    {
      response: reply(200, accountBody({ id: 9000, login: 'acme', type: 'Organization' })),
      port: { returns: { id: 9000, login: 'acme', type: 'Organization' } },
    },
  ],
  [
    'a type the platform has no word for, read as Other',
    {
      response: reply(200, accountBody({ id: 502, login: 'ghost', type: 'Mannequin' })),
      port: { returns: { id: 502, login: 'ghost', type: 'Other' } },
    },
  ],
  ['a 404, no such account', { response: reply(404, { message: 'Not Found' }), port: { returns: null } }],
  [
    'a login with markup in the answer',
    {
      response: reply(200, accountBody({ id: 503, login: '<img src=x onerror=alert(1)>', type: 'User' })),
      port: { rejects: 'GitHubResponseError' },
    },
  ],
  [
    'a login of 40 characters in the answer',
    {
      response: reply(200, accountBody({ id: 504, login: `a${'b'.repeat(39)}`, type: 'User' })),
      port: { rejects: 'GitHubResponseError' },
    },
  ],
  [
    'an id of zero',
    {
      response: reply(200, accountBody({ id: 0, login: 'ada', type: 'User' })),
      port: { rejects: 'GitHubResponseError' },
    },
  ],
  [
    'an id with a fraction',
    {
      response: reply(200, accountBody({ id: 1.5, login: 'ada', type: 'User' })),
      port: { rejects: 'GitHubResponseError' },
    },
  ],
  [
    'an id that is text',
    {
      response: reply(200, { ...accountBody({ id: 1, login: 'ada', type: 'User' }), id: '501' }),
      port: { rejects: 'GitHubResponseError' },
    },
  ],
  [
    'an answer without a type',
    {
      response: reply(200, { id: 505, login: 'ada' }),
      port: { rejects: 'GitHubResponseError' },
    },
  ],
  [
    'a 403 worded as a secondary rate limit, with no header',
    {
      response: reply(403, { message: 'You have exceeded a secondary rate limit.' }),
      port: { rejects: 'GitHubRateLimitedError' },
    },
  ],
  ['a plain 403', { response: reply(403, { message: 'Forbidden' }), port: { rejects: 'GitHubForbiddenError' } }],
  [
    'a 401, the token was refused twice',
    { response: reply(401, { message: 'Bad credentials' }), port: { rejects: 'GitHubAuthError' } },
  ],
];

/** What the mocked GitHub of the HTTP world needs to answer the lookup. */
export interface UserAccountRouteOptions {
  /** What each login answers; a login absent here has no account. */
  readonly accounts: UserAccounts;
  /** Whether the request's token was minted for an installation the world holds. */
  readonly known: (request: Request) => boolean;
}

/** The answer of the HTTP world for a scripted answer: the account as its body, or the failure's response. */
function responseFor(answer: UserAccountAnswer | undefined): Response {
  if (answer === undefined) {
    return HttpResponse.json({ message: 'Not Found' }, { status: 404 });
  }
  if (typeof answer === 'string') {
    const { status, headers, body } = failureOf(answer).response;
    return HttpResponse.json(body, { status, headers });
  }
  return HttpResponse.json(accountBody({ id: answer.id, login: answer.login, type: answer.type }));
}

/**
 * `GET /users/{username}` as GitHub answers it to an installation token: a 401 for a token nobody holds, a 404 for a login nobody
 * has, and for the others the account (or failure) scripted for the login, whichever installation asks.
 */
export function userAccountRoute({ accounts, known }: UserAccountRouteOptions) {
  return http.get(`${GITHUB_API_ORIGIN}/users/:login`, ({ request, params }) =>
    known(request)
      ? responseFor(accounts.get(String(params['login']).toLowerCase()))
      : HttpResponse.json({ message: 'Bad credentials' }, { status: 401 }),
  );
}

/**
 * `GET /orgs/{org}` (E21-S03) as GitHub answers it to an installation token: a 401 for a token nobody holds, a 404 for a login nobody
 * has and for one that belongs to a person or a bot, and for an organisation the account (or failure) scripted for the login.
 */
export function organizationAccountRoute({ accounts, known }: UserAccountRouteOptions) {
  return http.get(`${GITHUB_API_ORIGIN}/orgs/:org`, ({ request, params }) => {
    if (!known(request)) {
      return HttpResponse.json({ message: 'Bad credentials' }, { status: 401 });
    }
    const answer = accounts.get(String(params['org']).toLowerCase());
    return responseFor(typeof answer === 'object' && answer.type !== 'Organization' ? undefined : answer);
  });
}
