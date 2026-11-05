// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../shared/github-id.ts';
import type { ApprovalSubject } from '../domain/corporate-approval-request.ts';
import type { StoredSubject } from './corporate-approval-subject.ts';
import { CorporateRuleError } from './corporate-rule-error.ts';
import { withGitHubDeadline } from './github-deadline.ts';
import type { GitHubClient } from './ports/github.ts';
import { GitHubRateLimitedError, GitHubUnavailableError } from './ports/github-errors.ts';

// Which account, organisation or domain an approval is for (E21-S03). A login is looked up on GitHub with the installation's token and the
// approval stores the numeric id GitHub answers with, never the typed text; a domain needs no call. The call is made before the
// transaction of the approval opens, so no connection waits on GitHub and nothing is written when GitHub fails.

/** The calls of the GitHub client port that an approval needs (E21-S03) and the claim of an employee after it (E21-S04, the membership check). */
export type CorporateGitHub = Pick<GitHubClient, 'getUserAccount' | 'getOrganizationAccount' | 'isPublicOrgMember'>;

/** A GitHub the lookups cannot be made on, for a server built with no GitHub App: every call fails as an outage, so `503 upstream_unavailable`. */
export const corporateGitHubNotWired: CorporateGitHub = {
  getUserAccount: () =>
    Promise.reject(new GitHubUnavailableError('no GitHub App is configured: accounts cannot be looked up')),
  getOrganizationAccount: () =>
    Promise.reject(new GitHubUnavailableError('no GitHub App is configured: organisations cannot be looked up')),
  isPublicOrgMember: () =>
    Promise.reject(new GitHubUnavailableError('no GitHub App is configured: memberships cannot be checked')),
};

/**
 * How long a person waits for GitHub to say whether an account exists, repeats included.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const APPROVAL_LOOKUP_TIMEOUT_MS = 5000;

/**
 * What a failed call to GitHub is told as: `upstream_unavailable`, whatever the failure (a rate limit, a refusal, an outage, no answer in
 * time, a body that is not an account, a token that was turned down), since the person cannot fix any of them. A rate limit carries GitHub's
 * wait. The new error has fixed text: nothing GitHub sent, and nothing of the request, is carried on.
 * @throws CorporateRuleError `upstream_unavailable` always.
 */
function failedLookup(error: unknown): never {
  throw new CorporateRuleError(
    'upstream_unavailable',
    undefined,
    error instanceof GitHubRateLimitedError ? error.retryAfterSeconds : undefined,
  );
}

/**
 * What GitHub answers to the call `work` starts, within 5 seconds: an account for a lookup, whether a person is a member for the check of a
 * membership (E21-S04).
 * @throws CorporateRuleError `upstream_unavailable` (see {@link failedLookup}).
 */
export async function lookedUp<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await withGitHubDeadline(work, { ms: APPROVAL_LOOKUP_TIMEOUT_MS, what: 'an approval lookup' });
  } catch (error) {
    return failedLookup(error);
  }
}

/** The person a login names, or why there is none: no such account (`github_user_not_found`) or one that is no person (`not_a_user`). */
async function resolvedUser(github: CorporateGitHub, installation: GithubId, login: string): Promise<StoredSubject> {
  const account = await lookedUp(() => github.getUserAccount(installation, login));
  if (account === null) {
    throw new CorporateRuleError('github_user_not_found');
  }
  if (account.type !== 'User') {
    throw new CorporateRuleError('not_a_user');
  }
  return { kind: 'user', githubId: account.id, login: account.login };
}

/** The organisation a login names, or `github_org_not_found`. */
async function resolvedOrganisation(
  github: CorporateGitHub,
  installation: GithubId,
  login: string,
): Promise<StoredSubject> {
  const account = await lookedUp(() => github.getOrganizationAccount(installation, login));
  if (account === null) {
    throw new CorporateRuleError('github_org_not_found');
  }
  return { kind: 'github_org', githubId: account.id, login: account.login };
}

/**
 * The subject to store for the one the request named: a domain as it is, a login as the numeric id GitHub answers with and the login in the
 * case GitHub keeps. The installation is the tenant's own (`GET /users/{login}` and `GET /orgs/{login}` with its token), so a tenant's
 * lookups are made as that tenant.
 * @throws CorporateRuleError `github_user_not_found`, `not_a_user`, `github_org_not_found`, `upstream_unavailable`.
 */
export function resolveSubject(
  github: CorporateGitHub,
  installation: GithubId,
  subject: ApprovalSubject,
): Promise<StoredSubject> {
  switch (subject.kind) {
    case 'email_domain':
      return Promise.resolve(subject);
    case 'user':
      return resolvedUser(github, installation, subject.login);
    case 'github_org':
      return resolvedOrganisation(github, installation, subject.login);
  }
}
