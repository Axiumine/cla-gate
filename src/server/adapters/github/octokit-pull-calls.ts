// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GitHubCommitPage, GitHubPullRequest } from '../../services/ports/github.ts';
import { GitHubNotFoundError } from '../../services/ports/github-errors.ts';
import { type Channel, parseOne, type RequestHeaders, readOrNull } from './octokit-request.ts';
import { hasNextPage } from './pagination.ts';
import { commitPageSchema, comparisonSchema, pullRequestSchema } from './schemas.ts';

// The requests of the evaluation job (E07-S10): a pull request, its commits, the commits behind a head and the merge base
// of two commits. They are made with an installation's token, so `headers` carry it. Everything that becomes a part of a
// path is checked first: the repository name comes from GitHub, but a path is never built from text nobody checked.

/** Commits per page of a listing, the most GitHub gives. */
const PER_PAGE = 100;

/** The owner of a repository: a name GitHub can hold as an account. */
const OWNER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

/** The name of a repository, which is never `.` or `..` (checked apart: those would walk a path). */
const REPOSITORY = /^[A-Za-z0-9._-]{1,100}$/;

/** A SHA-1 or SHA-256 commit id in lower case: the only text of a commit that reaches a path or a query. */
const COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

interface RepositoryName {
  readonly owner: string;
  readonly repo: string;
}

/** The owner and the name of `fullName` (`owner/name`), or null for text GitHub cannot hold as a repository name. */
function repositoryOf(fullName: string): RepositoryName | null {
  const parts = fullName.split('/');
  const [owner = '', repo = ''] = parts;
  const valid = parts.length === 2 && OWNER.test(owner) && REPOSITORY.test(repo) && repo !== '.' && repo !== '..';
  return valid ? { owner, repo } : null;
}

/**
 * The repository `fullName` names, and every SHA of `shas` checked.
 * @throws GitHubNotFoundError for a name or a SHA that cannot exist, naming the route; no request is made for it.
 */
function checked(route: string, fullName: string, shas: readonly string[] = []): RepositoryName {
  const name = repositoryOf(fullName);
  if (name === null || !shas.every((sha) => COMMIT_SHA.test(sha))) {
    throw new GitHubNotFoundError(route);
  }
  return name;
}

/** `GET /repos/{owner}/{repo}/pulls/{pull_number}`, or null for a pull request that does not exist. */
export function fetchPullRequest(
  channel: Channel,
  headers: RequestHeaders,
  fullName: string,
  prNumber: number,
): Promise<GitHubPullRequest | null> {
  const route = 'GET /repos/{owner}/{repo}/pulls/{pull_number}';
  const name = repositoryOf(fullName);
  if (name === null) {
    return Promise.resolve(null);
  }
  return readOrNull(
    channel,
    route,
    () => channel.octokit.request(route, { ...name, pull_number: prNumber, headers }),
    pullRequestSchema,
  );
}

/** One page of the commits of a pull request. */
export async function fetchPullRequestCommits(
  channel: Channel,
  headers: RequestHeaders,
  pull: { readonly fullName: string; readonly prNumber: number; readonly page: number },
): Promise<GitHubCommitPage> {
  const route = 'GET /repos/{owner}/{repo}/pulls/{pull_number}/commits';
  const name = checked(route, pull.fullName);
  const answer = await channel.send(route, () =>
    channel.octokit.request(route, {
      ...name,
      pull_number: pull.prNumber,
      per_page: PER_PAGE,
      page: pull.page,
      headers,
    }),
  );
  return { commits: parseOne(route, commitPageSchema, answer.data), last: !hasNextPage(answer.link) };
}

/** One page of the history behind `headSha`. */
export async function fetchRepositoryCommits(
  channel: Channel,
  headers: RequestHeaders,
  history: { readonly fullName: string; readonly headSha: string; readonly page: number },
): Promise<GitHubCommitPage> {
  const route = 'GET /repos/{owner}/{repo}/commits';
  const name = checked(route, history.fullName, [history.headSha]);
  const answer = await channel.send(route, () =>
    channel.octokit.request(route, { ...name, sha: history.headSha, per_page: PER_PAGE, page: history.page, headers }),
  );
  return { commits: parseOne(route, commitPageSchema, answer.data), last: !hasNextPage(answer.link) };
}

/** The merge base of `baseSha` and `headSha`. */
export async function fetchMergeBase(
  channel: Channel,
  headers: RequestHeaders,
  fullName: string,
  commits: { readonly baseSha: string; readonly headSha: string },
): Promise<{ readonly mergeBaseSha: string }> {
  const route = 'GET /repos/{owner}/{repo}/compare/{basehead}';
  const { baseSha, headSha } = commits;
  const name = checked(route, fullName, [baseSha, headSha]);
  const answer = await channel.send(route, () =>
    channel.octokit.request(route, { ...name, basehead: `${baseSha}...${headSha}`, headers }),
  );
  return parseOne(route, comparisonSchema, answer.data);
}
