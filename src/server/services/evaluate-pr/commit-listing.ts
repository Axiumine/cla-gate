// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../../shared/github-id.ts';
import {
  collectRepoWalk,
  type ListingState,
  listingStateOf,
  planCommitListing,
  verifyListing,
} from '../../domain/evaluation/index.ts';
import type { GitHubClient, GitHubCommit, GitHubPullRequest } from '../ports/github.ts';

// The commits of a pull request, read from GitHub (E07-S04). The loop holds no rule of its own: `planCommitListing` says how
// to list, `collectRepoWalk` says what a walk has found and whether to fetch more, `verifyListing` checks a listing against
// the count GitHub reports and `listingStateOf` turns a settled result into the state the engine takes (E08-S07). What is
// left here is the I/O: which page to ask for next, and the one second chance a listing gets when it does not add up.

/**
 * The commits of a pull request still disagree with its commit count after a second look: a history with several merge
 * bases (a criss-cross merge) always ends here, and a push that never settles can too. The job fails, the queue retries it,
 * and a job that runs out of retries is dead-lettered with the hint to comment `/recheck` (E07-S05).
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode); the job lets it fail the run.
 */
export class CommitListingMismatchError extends Error {
  override readonly name = 'CommitListingMismatchError';

  constructor() {
    super('The commits of the pull request do not add up to the count GitHub reports');
  }
}

/** Where the commits are read: one pull request of one repository of one installation. */
export interface ListingScope {
  readonly github: GitHubClient;
  readonly githubInstallationId: GithubId;
  /** `owner/name`, as GitHub showed the repository at the start of the job. */
  readonly fullName: string;
}

/** The commits the engine reads, and the state of the listing. An `exceeded` listing carries none. */
export interface Listed {
  readonly listing: ListingState;
  readonly commits: readonly GitHubCommit[];
}

/**
 * A listing, or `superseded` when the second look at the pull request showed that it moved on (a push, a close) while its
 * commits were being read: the job's head SHA is no longer the one to evaluate.
 */
export type Collected = ({ readonly kind: 'listed' } & Listed) | { readonly kind: 'superseded' };

/** A listing that does not add up (`mismatch`) is not a listing: only the count and the pages can tell the two apart. */
type Attempt = Listed | 'mismatch';

async function pullCommits(scope: ListingScope, pr: GitHubPullRequest, pages: number): Promise<Attempt> {
  const commits: GitHubCommit[] = [];
  for (let page = 1; page <= pages; page += 1) {
    const read = await scope.github.listPullRequestCommits(scope.githubInstallationId, scope.fullName, pr.number, page);
    commits.push(...read.commits);
  }
  return verifyListing(
    pr.commitCount,
    commits.map((commit) => commit.sha),
  ) === 'ok'
    ? { listing: 'complete', commits }
    : 'mismatch';
}

/** The fetched commits whose SHA the walk kept, each once: a page that shifted lists a commit twice. */
function keptCommits(fetched: readonly GitHubCommit[], shas: readonly string[]): GitHubCommit[] {
  const wanted = new Set(shas);
  return [
    ...new Map(fetched.filter((commit) => wanted.has(commit.sha)).map((commit) => [commit.sha, commit])).values(),
  ];
}

async function repoWalk(scope: ListingScope, pr: GitHubPullRequest): Promise<Attempt> {
  const { github, githubInstallationId, fullName } = scope;
  const { mergeBaseSha } = await github.compareCommits(githubInstallationId, fullName, pr.baseSha, pr.headSha);
  const fetched: GitHubCommit[] = [];
  for (let pagesFetched = 1; ; pagesFetched += 1) {
    const page = await github.listRepositoryCommits(githubInstallationId, fullName, pr.headSha, pagesFetched);
    fetched.push(...page.commits);
    const walk = collectRepoWalk({
      headSha: pr.headSha,
      mergeBaseSha,
      commits: fetched,
      pagesFetched,
      exhausted: page.last,
    });
    const listing = listingStateOf(walk);
    if (walk.status === 'need_next_page') {
      continue;
    }
    // `inconsistent` is the one result that settles nothing and asks for nothing: it is a listing that does not add up.
    if (walk.status === 'inconsistent' || listing === null) {
      return 'mismatch';
    }
    if (walk.status === 'exceeded') {
      return { listing, commits: [] };
    }
    return verifyListing(pr.commitCount, walk.shas) === 'ok'
      ? { listing, commits: keptCommits(fetched, walk.shas) }
      : 'mismatch';
  }
}

/** One try at listing the commits of `pr`, the way `planCommitListing` says. */
async function listOnce(scope: ListingScope, pr: GitHubPullRequest): Promise<Attempt> {
  const plan = planCommitListing(pr.commitCount);
  const settled = listingStateOf(plan);
  if (settled !== null) {
    return { listing: settled, commits: [] };
  }
  return plan.strategy === 'pull_commits' ? pullCommits(scope, pr, plan.pages) : repoWalk(scope, pr);
}

/**
 * The commits of `pr`. A listing that disagrees with the pull request's commit count means a push was in flight while the
 * pages were read, so the pull request is read once more: when its head moved or it was closed the answer is `superseded`
 * (the push sent its own delivery), and otherwise the commits are listed again with the fresh count.
 * @throws CommitListingMismatchError when the second listing disagrees as well.
 */
export async function collectCommits(scope: ListingScope, pr: GitHubPullRequest): Promise<Collected> {
  const first = await listOnce(scope, pr);
  if (first !== 'mismatch') {
    return { kind: 'listed', ...first };
  }
  const fresh = await scope.github.getPullRequest(scope.githubInstallationId, scope.fullName, pr.number);
  if (fresh?.state !== 'open' || fresh.headSha !== pr.headSha) {
    return { kind: 'superseded' };
  }
  const second = await listOnce(scope, fresh);
  if (second === 'mismatch') {
    throw new CommitListingMismatchError();
  }
  return { kind: 'listed', ...second };
}
