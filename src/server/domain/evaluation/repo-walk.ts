// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { MAX_EVALUATED_COMMITS, MAX_WALK_PAGES } from './listing-plan.ts';
import { compareText } from './order.ts';

// E08-S07: the commits of a large pull request, read from the repository's commit list. That list is ordered by commit
// date and holds the whole history behind the head, and commit dates are not topological: a parent can be listed
// before its child, after it, or pages later. So the list is never cut at the merge base. The walk starts at the head,
// follows `parents` through the commits fetched so far, and stops on each path at the merge base, which is excluded.
// A parent that has not been fetched yet means more pages are needed, never a shorter pull request.

/** What the walk needs to know about a commit: its SHA and its parent SHAs. `CommitFacts` has both. */
export interface WalkCommit {
  readonly sha: string;
  readonly parents: readonly string[];
}

export interface RepoWalkInput {
  readonly headSha: string;
  readonly mergeBaseSha: string;
  /** Every commit fetched so far, from every page, in any order. A commit seen twice (a page shifted) is tolerated. */
  readonly commits: readonly WalkCommit[];
  readonly pagesFetched: number;
  /** True when the last page fetched was the last one the repository has. */
  readonly exhausted: boolean;
}

/** What a repo walk tells the loop: stop with a list, fetch the next page, give up, or distrust the data. */
export type RepoWalkResult =
  | { readonly status: 'complete'; readonly shas: readonly string[] }
  | { readonly status: 'need_next_page' }
  | { readonly status: 'exceeded' }
  | { readonly status: 'inconsistent' };

type ParentIndex = ReadonlyMap<string, readonly string[]>;

function sameParents(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((parent, position) => parent === b.at(position));
}

/**
 * Parents by SHA, all lower case. A SHA is a hash of the commit, so it can only ever have one parent list: two
 * different lists for one SHA are corrupt data (`null`), and picking either would make the result depend on page order.
 */
function indexParents(commits: readonly WalkCommit[]): ParentIndex | null {
  const index = new Map<string, readonly string[]>();
  for (const commit of commits) {
    const sha = commit.sha.toLowerCase();
    const parents = commit.parents.map((parent) => parent.toLowerCase());
    const known = index.get(sha);
    if (known !== undefined && !sameParents(known, parents)) {
      return null;
    }
    index.set(sha, parents);
  }
  return index;
}

interface Walked {
  readonly collected: ReadonlySet<string>;
  /** True when a commit the walk needed (the head or a parent) is not among the fetched ones. */
  readonly missing: boolean;
}

/** Every commit reachable from the head without passing the merge base, or `null` once there are too many of them. */
function walkFromHead(head: string, mergeBase: string, index: ParentIndex): Walked | null {
  const collected = new Set<string>();
  const pending = [head];
  let missing = false;
  for (let sha = pending.pop(); sha !== undefined; sha = pending.pop()) {
    if (sha === mergeBase || collected.has(sha)) {
      continue;
    }
    const parents = index.get(sha);
    if (parents === undefined) {
      missing = true;
      continue;
    }
    collected.add(sha);
    if (collected.size > MAX_EVALUATED_COMMITS) {
      return null;
    }
    pending.push(...parents);
  }
  return { collected, missing };
}

/**
 * The walk is stuck on a commit it has not seen. If the repository has no more pages, the data cannot be right
 * (`inconsistent`). Otherwise another page may hold it, unless the page budget is spent (`exceeded`). Anything but a
 * whole count below the budget counts as spent, so a bad counter ends the loop instead of feeding it.
 */
function whenStuck(pagesFetched: number, exhausted: boolean): RepoWalkResult {
  if (exhausted) {
    return { status: 'inconsistent' };
  }
  return Number.isSafeInteger(pagesFetched) && pagesFetched < MAX_WALK_PAGES
    ? { status: 'need_next_page' }
    : { status: 'exceeded' };
}

/**
 * Walks the commits fetched so far from the head to the merge base (E08-S07). The result is `complete` with the sorted
 * SHAs of the pull request (merge base excluded), `need_next_page` while a needed commit is not fetched yet,
 * `exceeded` when more than 2,000 commits are collected or when the 25th page (of 100) is fetched and the walk is
 * still stuck, and `inconsistent` when the repository has no more pages and a needed commit is still missing, or two
 * entries disagree about one commit. A head equal to the merge base is complete with no commits (the walk stops on it
 * at once); a root commit reached first ends its path (unrelated histories). A walk that finishes within the limits is
 * complete, however many pages it took. The result never depends on the order of `commits`.
 */
export function collectRepoWalk(input: RepoWalkInput): RepoWalkResult {
  const head = input.headSha.toLowerCase();
  const mergeBase = input.mergeBaseSha.toLowerCase();
  const index = indexParents(input.commits);
  if (index === null) {
    return { status: 'inconsistent' };
  }
  const walked = walkFromHead(head, mergeBase, index);
  if (walked === null) {
    return { status: 'exceeded' };
  }
  if (walked.missing) {
    return whenStuck(input.pagesFetched, input.exhausted);
  }
  return { status: 'complete', shas: [...walked.collected].sort(compareText) };
}
