// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../../shared/github-id.ts';
import { collectRepoWalk, type ListingState, listingStateOf } from '../../domain/evaluation/index.ts';
import type { GitHubClient, GitHubCommit } from '../ports/github.ts';

// The history behind a head SHA, read from GitHub page by page (E08-S07). It is the loop `commit-listing.ts` runs for a pull
// request and `merge-group/member-discovery.ts` runs for a merge group (E22-S01): `collectRepoWalk` says what a walk has found and
// whether to fetch more, `listingStateOf` turns a settled result into the state the engine takes, and what is left here is the I/O.

/** Where the commits are read: one pull request of one repository of one installation. */
export interface ListingScope {
  readonly github: GitHubClient;
  readonly githubInstallationId: GithubId;
  /** `owner/name`, as GitHub showed the repository at the start of the job. */
  readonly fullName: string;
}

/**
 * What reading the history behind a head SHA found (E08-S07, and E22-S01 for the commits of a merge group): the SHAs between the
 * merge base and the head with every commit fetched (`complete`), a history above the limits of the walk (`exceeded`, which carries
 * the state of the listing and no commit), or a history that does not add up (`mismatch`).
 */
export type History =
  | {
      readonly kind: 'complete';
      readonly shas: readonly string[];
      readonly fetched: readonly GitHubCommit[];
      readonly listing: ListingState;
    }
  | { readonly kind: 'exceeded'; readonly listing: ListingState }
  | { readonly kind: 'mismatch' };

/** The commits that `headSha` reaches and `mergeBaseSha` does not, read page by page from the repository's commit list. */
export async function readHistory(scope: ListingScope, headSha: string, mergeBaseSha: string): Promise<History> {
  const { github, githubInstallationId, fullName } = scope;
  const fetched: GitHubCommit[] = [];
  for (let pagesFetched = 1; ; pagesFetched += 1) {
    const page = await github.listRepositoryCommits(githubInstallationId, fullName, headSha, pagesFetched);
    fetched.push(...page.commits);
    const walk = collectRepoWalk({ headSha, mergeBaseSha, commits: fetched, pagesFetched, exhausted: page.last });
    const listing = listingStateOf(walk);
    if (walk.status === 'need_next_page') {
      continue;
    }
    // `inconsistent` is the one result that settles nothing and asks for nothing: it is a listing that does not add up.
    if (walk.status === 'inconsistent' || listing === null) {
      return { kind: 'mismatch' };
    }
    return walk.status === 'exceeded'
      ? { kind: 'exceeded', listing }
      : { kind: 'complete', shas: walk.shas, fetched, listing };
  }
}
