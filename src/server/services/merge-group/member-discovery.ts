// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { MAX_MERGE_GROUP_COMMITS, MAX_MERGE_GROUP_PULL_REQUESTS } from '../../domain/merge-group.ts';
import { type ListingScope, readHistory } from '../evaluate-pr/commit-listing.ts';
import { mapConcurrently } from '../map-concurrently.ts';

// Which pull requests a merge queue's group holds (E22-S01). A merge group cannot be read back from GitHub: the webhook gives its
// head and base SHAs and the name of its branch, and that is all. So the pull requests are found in two steps, and every doubt
// ends in `undetermined`, which the job reports as a failure and never as a pass:
//
//   1. the name of the branch (`.../pr-<number>-<sha>`) gives the last pull request added to the group (`tipPrNumber`);
//   2. when the range `base...head` holds more than one commit, the group may hold more than one pull request (a pull request
//      adds at least one commit, so a range of one commit is the pull request of step 1), and the pull requests GitHub associates
//      with each commit of the range, the open ones, are added.
//
// Both rules are unverified against a real merge queue (`docs/tooling-gotchas.md`, open verifications): they are written from the
// documented shape of the branch name and of the `commits/{sha}/pulls` answer. A false member (a commit shared with another open
// pull request) only adds an evaluation, which can fail the group; a pull request that neither step finds is the risk, which is why
// a range that cannot be read completely, or is too large to look up, is `undetermined` and never a group of one.

/** How many commits of the range are looked up at once: a request each, so the number bounds the load of one group on GitHub. */
const LOOKUP_CONCURRENCY = 5;

/** The group as the job knows it. */
export interface GroupRange {
  readonly baseSha: string;
  readonly headSha: string;
  /** The number the name of the group's branch gave, when it had the shape of a merge queue's. */
  readonly tipPrNumber?: number | undefined;
}

/** The pull requests of the group, in ascending order, or the fact that they could not be determined. */
export type Discovered =
  | { readonly kind: 'members'; readonly numbers: readonly number[] }
  | { readonly kind: 'undetermined' };

const UNDETERMINED: Discovered = { kind: 'undetermined' };

/** The open pull requests GitHub associates with the commits `shas`, as numbers; a closed one is not a member of a group in the queue. */
async function openPullRequestsOf(scope: ListingScope, shas: readonly string[]): Promise<number[]> {
  const found = await mapConcurrently(shas, LOOKUP_CONCURRENCY, (sha) =>
    scope.github.listPullRequestsForCommit(scope.githubInstallationId, scope.fullName, sha),
  );
  return found.flat().flatMap((pull) => (pull.state === 'open' ? [pull.number] : []));
}

/**
 * The pull requests of the group of `range`: the one the name of its branch gives, with the open ones the commits of the range
 * are associated with when the range holds more than one commit. `undetermined` for no pull request at all, for more than
 * {@link MAX_MERGE_GROUP_PULL_REQUESTS}, for a range of more than {@link MAX_MERGE_GROUP_COMMITS} commits (a lookup per commit is
 * not made for it), and for a history that exceeds the limits of the walk or does not add up.
 * @throws what the GitHub port throws (a commit GitHub does not have yet is a retry, not an answer).
 */
export async function discoverMembers(scope: ListingScope, range: GroupRange): Promise<Discovered> {
  const numbers = new Set<number>(range.tipPrNumber === undefined ? [] : [range.tipPrNumber]);
  const { mergeBaseSha } = await scope.github.compareCommits(
    scope.githubInstallationId,
    scope.fullName,
    range.baseSha,
    range.headSha,
  );
  const history = await readHistory(scope, range.headSha, mergeBaseSha);
  if (history.kind !== 'complete' || history.shas.length > MAX_MERGE_GROUP_COMMITS) {
    return UNDETERMINED;
  }
  if (history.shas.length > 1) {
    for (const number of await openPullRequestsOf(scope, history.shas)) {
      numbers.add(number);
    }
  }
  return numbers.size === 0 || numbers.size > MAX_MERGE_GROUP_PULL_REQUESTS
    ? UNDETERMINED
    : { kind: 'members', numbers: [...numbers].sort((first, second) => first - second) };
}
