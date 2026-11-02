// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../../shared/github-id.ts';
import type {
  GitHubCommit,
  GitHubCommitPage,
  GitHubPullRequest,
  GitHubPullRequestPage,
  GitHubRepository,
} from '../ports/github.ts';
import { GitHubNotFoundError } from '../ports/github-errors.ts';

// What `FakeGitHub` (../test-support.ts) is built from, kept apart so that neither file outgrows the caps: waiting for a
// signal, taking a scripted entry, paging a listing as GitHub does, and the keys of the world's maps.

/** `work`, or a rejection with the reason of `signal` as soon as it aborts, whichever comes first. */
export function abortable<T>(signal: AbortSignal | undefined, work: Promise<T>): Promise<T> {
  if (signal === undefined) {
    return work;
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      try {
        signal.throwIfAborted();
      } catch (reason) {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the reason of a signal is whatever the aborter passed, and the caller must get exactly that
        reject(reason);
      }
    };
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

/** Removes and returns the first scripted entry for `method`, or undefined. */
export function takeFirst<T extends { readonly method: string }>(queue: T[], method: string): T | undefined {
  const index = queue.findIndex((entry) => entry.method === method);
  return index === -1 ? undefined : queue.splice(index, 1)[0];
}

/** A commit id GitHub can hold: the adapter sends nothing else in a path or a query, and so the fake knows nothing else. */
export const COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** Commits per page of a listing: the most GitHub gives. */
const COMMITS_PER_PAGE = 100;

/** Page `page` (1-based) of `commits`; a listing nobody scripted is a 404, as for a repository GitHub does not have. */
export function pageOf(commits: readonly GitHubCommit[] | undefined, page: number, route: string): GitHubCommitPage {
  if (commits === undefined) {
    throw new GitHubNotFoundError(route);
  }
  const from = (page - 1) * COMMITS_PER_PAGE;
  return { commits: commits.slice(from, from + COMMITS_PER_PAGE), last: from + COMMITS_PER_PAGE >= commits.length };
}

/** Page `page` (1-based, 100) of the open pull requests of `fullName` among `pulls`, newest (highest number) first, as `GET .../pulls?state=open` lists them. */
function openPage(pulls: readonly GitHubPullRequest[], page: number): GitHubPullRequestPage {
  const open = pulls
    .filter((pull) => pull.state === 'open')
    .toSorted((a, b) => b.number - a.number)
    .map(({ number, state, headSha }) => ({ number, state, headSha }));
  const from = (page - 1) * COMMITS_PER_PAGE;
  return { pulls: open.slice(from, from + COMMITS_PER_PAGE), last: from + COMMITS_PER_PAGE >= open.length };
}

/**
 * The listing of the open pull requests of `fullName` in the world, for the installation `entry` stands for (E07-S08): a
 * repository the installation does not reach is a 404, as it is for GitHub. Names are compared without regard to case.
 */
export function openPullsPage(
  state: { readonly pullRequests: ReadonlyMap<string, GitHubPullRequest> },
  entry: { readonly installation: { readonly id: GithubId }; readonly repositories: readonly GitHubRepository[] },
  fullName: string,
  page: number,
): GitHubPullRequestPage {
  if (!entry.repositories.some((repository) => repository.fullName.toLowerCase() === fullName.toLowerCase())) {
    throw new GitHubNotFoundError('GET /repos/{owner}/{repo}/pulls');
  }
  const prefix = `${repositoryKey(entry.installation.id, fullName)}#`;
  return openPage(
    [...state.pullRequests].filter(([key]) => key.startsWith(prefix)).map(([, pull]) => pull),
    page,
  );
}

/** GitHub compares repository names without regard to case too. */
export const repositoryKey = (githubInstallationId: GithubId, fullName: string): string =>
  `${githubInstallationId}/${fullName.toLowerCase()}`;

export const pullKey = (githubInstallationId: GithubId, fullName: string, prNumber: number): string =>
  `${repositoryKey(githubInstallationId, fullName)}#${prNumber}`;

export const mergeKey = (
  githubInstallationId: GithubId,
  fullName: string,
  { baseSha, headSha }: { readonly baseSha: string; readonly headSha: string },
): string => `${repositoryKey(githubInstallationId, fullName)}@${baseSha}...${headSha}`;

export const commentKey = (githubInstallationId: GithubId, fullName: string, commentId: GithubId): string =>
  `${repositoryKey(githubInstallationId, fullName)}/comments/${commentId}`;

export const commitKey = (githubInstallationId: GithubId, fullName: string, headSha: string): string =>
  `${repositoryKey(githubInstallationId, fullName)}/commits/${headSha}`;

/** GitHub compares organisation and login names without regard to case. */
export const membershipKey = (githubInstallationId: GithubId, org: string, login: string): string =>
  `${githubInstallationId}/${org.toLowerCase()}/${login.toLowerCase()}`;

/** GitHub compares repository and login names without regard to case. */
export const permissionKey = (githubInstallationId: GithubId, fullName: string, login: string): string =>
  `${githubInstallationId}/${fullName.toLowerCase()}/${login.toLowerCase()}`;
