// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../shared/github-id.ts';
import { ClaRuleError } from './cla-rule-error.ts';
import { withGitHubDeadline } from './github-deadline.ts';
import type { GitHubClient, GitHubCommitRef } from './ports/github.ts';
import {
  GitHubNotFoundError,
  GitHubRateLimitedError,
  GitHubUnavailableError,
  GitHubUnprocessableError,
} from './ports/github-errors.ts';

// Whether the repository has the commit an override is for (E15-S05). The call is made with the installation's token before the
// transaction of the override opens, so no connection waits on GitHub, and it is made for the repository of the request under the name
// GitHub showed last: a commit of another repository of the tenant is not found there and so cannot be pre-approved by mistake.

/** The one call of the GitHub client port that recording an override needs. */
export type CommitGitHub = Pick<GitHubClient, 'getCommit'>;

/** A GitHub the lookup cannot be made on, for a server built with no GitHub App: every call fails as an outage, so `502 github_unavailable`. */
export const commitGitHubNotWired: CommitGitHub = {
  getCommit: () =>
    Promise.reject(new GitHubUnavailableError('no GitHub App is configured: commits cannot be looked up')),
};

/**
 * How long a person waits for GitHub to say whether a commit exists, repeats included (E15-S05).
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const COMMIT_LOOKUP_TIMEOUT_MS = 5000;

/** The commit to look for: the lower-case SHA, in the repository `fullName` of the installation GitHub knows as `githubInstallationId`. */
export interface CommitToFind {
  readonly githubInstallationId: GithubId;
  readonly fullName: string;
  readonly sha: string;
}

/**
 * What a failed call to GitHub is told as: a commit or repository GitHub does not show, or refuses the SHA of (404, 422), as a commit
 * that is not there; a rate limit and an outage as they are (`503` with GitHub's wait and `502`); anything else (a refusal, a body that
 * is not a commit, a token that was turned down) as an outage too, since the person cannot fix it. The new error has fixed text: nothing
 * GitHub sent, and nothing of the request, is carried on.
 * @throws ClaRuleError `commit_not_found`; GitHubRateLimitedError, GitHubUnavailableError otherwise, always.
 */
function failedLookup(error: unknown): never {
  if (error instanceof GitHubNotFoundError || error instanceof GitHubUnprocessableError) {
    throw new ClaRuleError('commit_not_found');
  }
  if (error instanceof GitHubRateLimitedError || error instanceof GitHubUnavailableError) {
    throw error;
  }
  throw new GitHubUnavailableError('GitHub could not answer the lookup of the commit');
}

/**
 * The commit GitHub shows in the repository, within 5 seconds.
 * @returns what GitHub answered, which is null for a commit it does not show.
 * @throws ClaRuleError `commit_not_found` (see {@link failedLookup}); GitHubRateLimitedError, GitHubUnavailableError.
 */
async function lookedUp(github: CommitGitHub, commit: CommitToFind): Promise<GitHubCommitRef | null> {
  try {
    return await withGitHubDeadline(() => github.getCommit(commit.githubInstallationId, commit.fullName, commit.sha), {
      ms: COMMIT_LOOKUP_TIMEOUT_MS,
      what: 'a commit lookup',
    });
  } catch (error) {
    return failedLookup(error);
  }
}

/**
 * Checks that the repository has the commit: `GET /repos/{full_name}/commits/{sha}` with the installation's token, 5 seconds at most.
 * @throws ClaRuleError `commit_not_found` for a commit GitHub does not show (404 or 422); GitHubRateLimitedError (`503
 * github_rate_limited`); GitHubUnavailableError (`502 github_unavailable`) for an outage, no answer in time and any other failure.
 */
export async function requireCommit(github: CommitGitHub, commit: CommitToFind): Promise<void> {
  if ((await lookedUp(github, commit)) === null) {
    throw new ClaRuleError('commit_not_found');
  }
}
