// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../../shared/github-id.ts';
import { MAX_SWEPT_PULLS, SWEEP_PAGE_SIZE } from '../../domain/sweep.ts';
import type { GitHubClient, GitHubPullRequestRef } from '../ports/github.ts';

// The open pull requests of one repository, as far as the sweep reads them (E07-S08).

/** The pull requests read, and whether there were more than the sweep reads in one run. */
export interface OpenPulls {
  /** Open pull requests, newest first, each number once, at most {@link MAX_SWEPT_PULLS}. */
  readonly pulls: readonly GitHubPullRequestRef[];
  /** True when GitHub names a page after the last one read: the oldest open pull requests were left for a later run. */
  readonly truncated: boolean;
}

/**
 * Reads the open pull requests of `fullName` 100 to a page, newest first, until GitHub names no next page or
 * {@link MAX_SWEPT_PULLS} are read: ten requests at most per run and repository. A pull request opened while the pages are
 * read can shift one from a page to the next, so a number met twice is kept once.
 * @throws GitHubNotFoundError, GitHubForbiddenError, a rate limit or whatever else the client throws; nothing is returned
 * from a listing that failed half way.
 */
export async function listOpenPulls(
  github: GitHubClient,
  githubInstallationId: GithubId,
  fullName: string,
): Promise<OpenPulls> {
  const byNumber = new Map<number, GitHubPullRequestRef>();
  for (let page = 1; page <= MAX_SWEPT_PULLS / SWEEP_PAGE_SIZE; page += 1) {
    const read = await github.listOpenPullRequests(githubInstallationId, fullName, page);
    for (const pull of read.pulls) {
      byNumber.set(pull.number, pull);
    }
    if (read.last || read.pulls.length === 0) {
      return { pulls: [...byNumber.values()], truncated: false };
    }
  }
  return { pulls: [...byNumber.values()].slice(0, MAX_SWEPT_PULLS), truncated: true };
}
