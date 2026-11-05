// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { ALLOWLIST_LOGIN_PATTERN } from '../../../shared/allowlist.ts';
import { GITHUB_ORG_LOGIN_PATTERN } from '../../../shared/corporate-approvals.ts';
import type { GitHubUserAccount } from '../ports/github.ts';
import { GitHubRateLimitedError, GitHubResponseError, GitHubUnavailableError } from '../ports/github-errors.ts';

// The accounts a GitHub in memory knows by login (E14-S06), shared by `FakeGitHub` and by the mocked GitHub of the Octokit adapter's
// tests, so that both answer one set of rules: an account is found without regard to the case of the login, the answer carries the
// login in the case GitHub keeps, a login that cannot be one finds nothing, and a login a test scripted as a failure fails the way
// the adapter does. Accounts are GitHub's, not an installation's: any installation's token finds any account.

/** How a lookup of an account can fail, as a test scripts it: GitHub is limiting the installation, is down (a 5xx), or answers with a body that is not an account. */
export type UserAccountFailure = 'rate_limited' | 'unavailable' | 'malformed';

/** What a login is scripted to answer: the account that has it, or a failure. A login with no entry has no account (a 404). */
export type UserAccountAnswer = GitHubUserAccount | UserAccountFailure;

/** The scripted answers by login in lower case, GitHub compares logins without regard to case. */
export type UserAccounts = Map<string, UserAccountAnswer>;

/** The route the lookup names in its errors. */
const ACCOUNT_ROUTE = 'GET /users/{username}';

/**
 * The failure a scripted lookup is, as the adapter tells it: the rate limit, the outage, or the body that is not what the route sends.
 * @throws GitHubRateLimitedError, GitHubUnavailableError, GitHubResponseError always.
 */
function failWith(failure: UserAccountFailure, route: string): never {
  switch (failure) {
    case 'rate_limited':
      throw new GitHubRateLimitedError(120, 'primary');
    case 'unavailable':
      throw new GitHubUnavailableError(`GitHub answered 500 to ${route}`);
    case 'malformed':
      throw new GitHubResponseError(route, []);
  }
}

/** The function that scripts `accounts`: what `login` answers from now on. */
export function scriptInto(accounts: UserAccounts): (login: string, answer: UserAccountAnswer) => void {
  return (login, answer) => {
    accounts.set(login.toLowerCase(), answer);
  };
}

/**
 * What the lookup of `login` answers: the account, or null for a login that cannot be one and for one nobody has.
 * @throws GitHubRateLimitedError, GitHubUnavailableError, GitHubResponseError for a login scripted to fail.
 */
export function userAccountOf(accounts: UserAccounts, login: string): GitHubUserAccount | null {
  const answer = ALLOWLIST_LOGIN_PATTERN.test(login) ? accounts.get(login.toLowerCase()) : undefined;
  if (answer === undefined) {
    return null;
  }
  return typeof answer === 'string' ? failWith(answer, ACCOUNT_ROUTE) : answer;
}

/**
 * What `GET /orgs/{org}` (E21-S03) answers for `login`, from the same accounts: the account when it is an organisation, null for a login
 * that cannot be an organisation's, for one nobody has and for one that belongs to a person or a bot, which is a 404 on that route. A login
 * scripted to fail fails here too, since GitHub limits and breaks the one namespace of logins.
 * @throws GitHubRateLimitedError, GitHubUnavailableError, GitHubResponseError for a login scripted to fail.
 */
export function orgAccountOf(accounts: UserAccounts, login: string): GitHubUserAccount | null {
  if (!GITHUB_ORG_LOGIN_PATTERN.test(login)) {
    return null;
  }
  const account = userAccountOf(accounts, login);
  return account?.type === 'Organization' ? account : null;
}

/** What a person's public membership of an organisation is scripted to answer (E21-S04): a verdict, or a failure of the call. A pair with no entry was never scripted. */
export type PublicMemberAnswer = boolean | UserAccountFailure;

/** The scripted answers by `org/login` in lower case, GitHub compares logins without regard to case. Memberships are GitHub's, not an installation's. */
export type PublicMembers = Map<string, PublicMemberAnswer>;

/** The key of a pair in {@link PublicMembers}. */
export const publicMemberKey = (org: string, login: string): string => `${org.toLowerCase()}/${login.toLowerCase()}`;

/** The function that scripts `members`: what the check of `login` in `org` answers from now on. */
export function scriptPublicMemberInto(
  members: PublicMembers,
): (org: string, login: string, answer: PublicMemberAnswer) => void {
  return (org, login, answer) => {
    members.set(publicMemberKey(org, login), answer);
  };
}

/** The route the check names in its errors. */
const PUBLIC_MEMBER_ROUTE = 'GET /orgs/{org}/public_members/{username}';

/**
 * What the check of `login` in `org` answers (E21-S04): the scripted verdict, false for a pair nobody scripted and for names that cannot be
 * logins, and a failure for a pair scripted to fail.
 * @throws GitHubRateLimitedError, GitHubUnavailableError, GitHubResponseError for a pair scripted to fail.
 */
export function publicMemberOf(members: PublicMembers, who: { readonly org: string; readonly login: string }): boolean {
  if (!GITHUB_ORG_LOGIN_PATTERN.test(who.org) || !ALLOWLIST_LOGIN_PATTERN.test(who.login)) {
    return false;
  }
  const answer = members.get(publicMemberKey(who.org, who.login));
  return typeof answer === 'string' ? failWith(answer, PUBLIC_MEMBER_ROUTE) : (answer ?? false);
}
