// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { ALLOWLIST_LOGIN_PATTERN } from '../../../shared/allowlist.ts';
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
  switch (answer) {
    case undefined:
      return null;
    case 'rate_limited':
      throw new GitHubRateLimitedError(120, 'primary');
    case 'unavailable':
      throw new GitHubUnavailableError(`GitHub answered 500 to ${ACCOUNT_ROUTE}`);
    case 'malformed':
      throw new GitHubResponseError(ACCOUNT_ROUTE, []);
    default:
      return answer;
  }
}
