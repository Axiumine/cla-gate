// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import {
  APPROVAL_LOOKUP_TIMEOUT_MS,
  type CorporateGitHub,
  corporateGitHubNotWired,
  resolveSubject,
} from './corporate-approval-lookup.ts';
import { CorporateRuleError } from './corporate-rule-error.ts';
import type { GitHubUserAccount } from './ports/github.ts';
import {
  GitHubAuthError,
  GitHubForbiddenError,
  GitHubNotFoundError,
  GitHubRateLimitedError,
  GitHubResponseError,
  GitHubUnavailableError,
} from './ports/github-errors.ts';

// What an approval subject becomes before it is stored (E21-S03): a domain as it is, a login as the numeric id GitHub answers with, what
// each answer and each failure of the GitHub client port is told as, and the 5 seconds a person waits for it. Fake timers, so the
// boundary is exact and nothing sleeps.

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const INSTALLATION = parseGithubId(5000);

const account = (id: number, login: string, type: GitHubUserAccount['type']): GitHubUserAccount => ({
  id: parseGithubId(id),
  login,
  type,
});

/** A GitHub whose two lookups answer `answer` (a promise to settle as it is, or a function to call), and the calls it was given. */
function githubThat(answer: () => Promise<GitHubUserAccount | null>) {
  const calls: unknown[][] = [];
  const github: CorporateGitHub = {
    getUserAccount: (...args) => {
      calls.push(['user', ...args]);
      return answer();
    },
    getOrganizationAccount: (...args) => {
      calls.push(['org', ...args]);
      return answer();
    },
  };
  return { github, calls };
}

/** What `resolveSubject` settled as, without failing the test on a rejection. */
const outcomeOf = (work: Promise<unknown>): Promise<unknown> =>
  work.then(
    (value) => value,
    (failure: unknown) => failure,
  );

test('a domain is stored as it is, and GitHub is not asked', async () => {
  const { github, calls } = githubThat(() => Promise.reject(new Error('not asked')));
  const subject = { kind: 'email_domain', domain: 'acme.example' } as const;
  expect(await resolveSubject(github, INSTALLATION, subject)).toEqual(subject);
  expect(calls).toEqual([]);
});

test('a login is looked up on the installation and stored by the numeric id, with the login in the case GitHub keeps', async () => {
  const { github, calls } = githubThat(() => Promise.resolve(account(4711, 'Ada-Lovelace', 'User')));
  expect(await resolveSubject(github, INSTALLATION, { kind: 'user', login: 'ada-lovelace' })).toEqual({
    kind: 'user',
    githubId: 4711,
    login: 'Ada-Lovelace',
  });
  expect(calls).toEqual([['user', INSTALLATION, 'ada-lovelace']]);
});

test('an organisation is looked up on the installation by its own call and stored by the numeric id', async () => {
  const { github, calls } = githubThat(() => Promise.resolve(account(9100, 'Acme-Org', 'Organization')));
  expect(await resolveSubject(github, INSTALLATION, { kind: 'github_org', login: 'acme-org' })).toEqual({
    kind: 'github_org',
    githubId: 9100,
    login: 'Acme-Org',
  });
  expect(calls).toEqual([['org', INSTALLATION, 'acme-org']]);
});

test.each([
  ['a login nobody has', { kind: 'user', login: 'nobody' }, null, 'github_user_not_found'],
  ['a bot', { kind: 'user', login: 'dependabot[bot]' }, account(1, 'dependabot[bot]', 'Bot'), 'not_a_user'],
  ['an organisation, as a person', { kind: 'user', login: 'acme' }, account(2, 'acme', 'Organization'), 'not_a_user'],
  ['an organisation nobody has', { kind: 'github_org', login: 'nobody' }, null, 'github_org_not_found'],
] as const)('%s is %s with the rule only', async (_label, subject, answer, rule) => {
  const { github } = githubThat(() => Promise.resolve(answer));
  const failure = await outcomeOf(resolveSubject(github, INSTALLATION, subject));
  expect(failure).toBeInstanceOf(CorporateRuleError);
  expect(failure).toMatchObject({ rule, details: undefined, retryAfterSeconds: undefined });
});

test('a rate limit is upstream_unavailable and carries the wait GitHub asked for', async () => {
  const { github } = githubThat(() => Promise.reject(new GitHubRateLimitedError(120, 'secondary')));
  const failure = await outcomeOf(resolveSubject(github, INSTALLATION, { kind: 'user', login: 'ada' }));
  expect(failure).toBeInstanceOf(CorporateRuleError);
  expect(failure).toMatchObject({ rule: 'upstream_unavailable', retryAfterSeconds: 120 });
});

test.each([
  ['a refusal of the token', new GitHubForbiddenError('GET /users/zzzz')],
  ['a 404 on a route that should not give one', new GitHubNotFoundError('GET /users/zzzz')],
  ['an outage', new GitHubUnavailableError('GitHub answered 500 to zzzz')],
  ['an answer that is not an account', new GitHubResponseError('GET /users/{username}', ['zzzz'])],
  ['a rejected App credential', new GitHubAuthError()],
  ['an unexpected error', new TypeError('zzzz')],
])('%s is upstream_unavailable with no wait, and nothing GitHub sent is carried on', async (_label, error) => {
  const { github } = githubThat(() => Promise.reject(error));
  for (const subject of [
    { kind: 'user', login: 'ada' },
    { kind: 'github_org', login: 'acme' },
  ] as const) {
    const failure = await outcomeOf(resolveSubject(github, INSTALLATION, subject));
    expect(failure).toBeInstanceOf(CorporateRuleError);
    expect(failure).toMatchObject({
      rule: 'upstream_unavailable',
      retryAfterSeconds: undefined,
      message: 'upstream_unavailable',
    });
    expect(String(failure)).not.toContain('zzzz');
  }
});

test('the deadline is 5 seconds', () => {
  expect(APPROVAL_LOOKUP_TIMEOUT_MS).toBe(5000);
});

test('a lookup that has not answered at 4.999 s is still waited for, and fails as an outage at 5 s, with no timer left', async () => {
  const { github } = githubThat(() => new Promise<never>(() => undefined));
  let outcome: unknown = 'pending';
  void outcomeOf(resolveSubject(github, INSTALLATION, { kind: 'user', login: 'ada' })).then((settled) => {
    outcome = settled;
  });
  await vi.advanceTimersByTimeAsync(4999);
  expect(outcome).toBe('pending');
  await vi.advanceTimersByTimeAsync(1);
  expect(outcome).toBeInstanceOf(CorporateRuleError);
  expect(outcome).toMatchObject({ rule: 'upstream_unavailable' });
  expect(vi.getTimerCount()).toBe(0);
});

test('an answer in time leaves no timer behind', async () => {
  const { github } = githubThat(() => Promise.resolve(account(4711, 'Ada', 'User')));
  await resolveSubject(github, INSTALLATION, { kind: 'user', login: 'ada' });
  expect(vi.getTimerCount()).toBe(0);
});

test('a server with no GitHub App cannot look an account up: every call is an outage', async () => {
  for (const subject of [
    { kind: 'user', login: 'ada' },
    { kind: 'github_org', login: 'acme' },
  ] as const) {
    const failure = await outcomeOf(resolveSubject(corporateGitHubNotWired, INSTALLATION, subject));
    expect(failure).toMatchObject({ rule: 'upstream_unavailable' });
  }
  const direct = await outcomeOf(corporateGitHubNotWired.getUserAccount(INSTALLATION, 'ada'));
  expect(String(direct)).toBe('GitHubUnavailableError: no GitHub App is configured: accounts cannot be looked up');
  const org = await outcomeOf(corporateGitHubNotWired.getOrganizationAccount(INSTALLATION, 'acme'));
  expect(String(org)).toBe('GitHubUnavailableError: no GitHub App is configured: organisations cannot be looked up');
});
