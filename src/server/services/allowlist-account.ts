// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { AllowlistEntryRequest } from '../../shared/allowlist.ts';
import { type GithubId, parseGithubId } from '../../shared/github-id.ts';
import { checkAccountKind, snapshotOf } from '../domain/allowlist-entry.ts';
import { ClaRuleError } from './cla-rule-error.ts';
import type { InstallationRow } from './installation-state.ts';
import type { GitHubClient, GitHubUserAccount } from './ports/github.ts';
import { GitHubNotFoundError, GitHubRateLimitedError, GitHubUnavailableError } from './ports/github-errors.ts';

// Which account an allowlist entry exempts (E14-S06): the numeric id and the login to keep for display. An entry typed as a login
// is looked up on GitHub with the installation's token and stored by the id GitHub answers with, never by the typed text; the
// members of the organisation are the installation's own account, which the database knows, after the App has shown that it may
// list them. The calls are made before the transaction of the entry opens, so no connection waits on GitHub.

/** The two calls of the GitHub client port that adding an entry needs. */
export type AllowlistGitHub = Pick<GitHubClient, 'getUserAccount' | 'probeMembersPermission'>;

/** A GitHub the lookups cannot be made on, for a server built with no GitHub App: every call fails as an outage, so `502 github_unavailable`. */
export const allowlistGitHubNotWired: AllowlistGitHub = {
  getUserAccount: () =>
    Promise.reject(new GitHubUnavailableError('no GitHub App is configured: accounts cannot be looked up')),
  probeMembersPermission: () =>
    Promise.reject(new GitHubUnavailableError('no GitHub App is configured: members cannot be listed')),
};

/** The account an entry exempts. `loginSnapshot` is for display only, and null when there is none worth showing. */
export interface ListedAccount {
  readonly githubId: GithubId;
  readonly loginSnapshot: string | null;
}

/** What the API tells the client to do about an organisation given as a person or a bot, or a person given as a bot and the other way round. */
function kindHint(verdict: 'use_org_members' | 'use_other_kind' | 'not_supported'): string {
  switch (verdict) {
    case 'use_org_members':
      return 'An organisation is not a person or a bot: add it with the kind org_members to exempt its members.';
    case 'use_other_kind':
      return 'This account is of another type: a person is added as a user and an automation as a bot.';
    case 'not_supported':
      return 'This kind of account cannot be exempted: only people and bots can.';
  }
}

/** What the members of an organisation need to be listable, as the client is told. */
const MEMBERS_PERMISSION_HINT =
  'Accept the updated permissions of the GitHub App on the installation page of your organisation, then add the entry again.';

/**
 * What a failed call to GitHub is told as: a rate limit and an outage as they are (`503` with GitHub's wait and `502`), anything
 * else (a refusal, a body that is not an account, a token that was turned down) as an outage too, since the person cannot fix it.
 * The new error has fixed text: nothing GitHub sent, and nothing of the request, is carried on.
 * @throws GitHubRateLimitedError, GitHubUnavailableError always.
 */
function failedLookup(error: unknown): never {
  if (error instanceof GitHubRateLimitedError || error instanceof GitHubUnavailableError) {
    throw error;
  }
  throw new GitHubUnavailableError('GitHub could not answer the lookup of the allowlist');
}

/**
 * The account `login` names, for an entry of `kind`.
 * @throws ClaRuleError `github_account_not_found` (404), `kind_mismatch` (with the fix as `details.hint`); GitHubRateLimitedError, GitHubUnavailableError.
 */
async function namedAccount(
  github: AllowlistGitHub,
  githubInstallationId: GithubId,
  entry: Extract<AllowlistEntryRequest, { login: string }>,
): Promise<ListedAccount> {
  let account: GitHubUserAccount | null;
  try {
    account = await github.getUserAccount(githubInstallationId, entry.login);
  } catch (error) {
    return failedLookup(error);
  }
  if (account === null) {
    throw new ClaRuleError('github_account_not_found');
  }
  const verdict = checkAccountKind(entry.kind, account.type);
  if (verdict !== 'ok') {
    throw new ClaRuleError('kind_mismatch', { hint: kindHint(verdict) });
  }
  return { githubId: account.id, loginSnapshot: snapshotOf(account.login) };
}

/**
 * Whether the App may list the members of the organisation of the installation.
 * @throws ClaRuleError `no_organization` when GitHub says the account is no organisation; GitHubRateLimitedError, GitHubUnavailableError.
 */
async function mayListMembers(github: AllowlistGitHub, githubInstallationId: GithubId): Promise<boolean> {
  try {
    return await github.probeMembersPermission(githubInstallationId);
  } catch (error) {
    return error instanceof GitHubNotFoundError ? noOrganization() : failedLookup(error);
  }
}

/** @throws ClaRuleError `no_organization`. */
function noOrganization(): never {
  throw new ClaRuleError('no_organization');
}

/**
 * The installation's own organisation as the account of an `org_members` entry: its id and login are the ones the installation
 * stores. Membership of any other organisation cannot be checked with this installation's token, so none is accepted.
 * @throws ClaRuleError `no_organization` for the installation of a user, `members_permission_missing` (with the fix as `details.hint`);
 * GitHubRateLimitedError, GitHubUnavailableError.
 */
async function ownOrganisation(github: AllowlistGitHub, installation: InstallationRow): Promise<ListedAccount> {
  if (installation.account_type !== 'Organization') {
    throw new ClaRuleError('no_organization');
  }
  if (!(await mayListMembers(github, parseGithubId(installation.github_installation_id)))) {
    throw new ClaRuleError('members_permission_missing', { hint: MEMBERS_PERMISSION_HINT });
  }
  return { githubId: parseGithubId(installation.account_id), loginSnapshot: snapshotOf(installation.account_login) };
}

/**
 * The account the request asks to exempt, resolved on GitHub or from the installation, before anything is written.
 * @throws ClaRuleError (see {@link namedAccount} and {@link ownOrganisation}); GitHubRateLimitedError, GitHubUnavailableError.
 */
export function resolveAccount(
  github: AllowlistGitHub,
  installation: InstallationRow,
  entry: AllowlistEntryRequest,
): Promise<ListedAccount> {
  return entry.kind === 'org_members'
    ? ownOrganisation(github, installation)
    : namedAccount(github, parseGithubId(installation.github_installation_id), entry);
}
