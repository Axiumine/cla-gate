// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../../shared/github-id.ts';
import type { GitHubIssueComment, GitHubPullRequestRef } from '../../services/ports/github.ts';
import { COMMIT_SHA, checked, PER_PAGE, repositoryOf } from './octokit-names.ts';
import { type Channel, parseOne, type RequestHeaders, readOrNull } from './octokit-request.ts';
import { issueCommentSchema, pullRequestRefPageSchema } from './schemas.ts';

// The requests of the manual re-evaluation (E07-S07): a comment, and the pull requests GitHub associates with a commit; and
// (E09-S06) the rewrite of a comment the platform wrote. They are made with an installation's token, so `headers` carry it, and
// nothing that cannot be a name or a SHA reaches a path.

/** `GET /repos/{owner}/{repo}/issues/comments/{comment_id}` (E07-S07), or null for a comment that does not exist. */
export function fetchIssueComment(
  channel: Channel,
  headers: RequestHeaders,
  fullName: string,
  commentId: GithubId,
): Promise<GitHubIssueComment | null> {
  const route = 'GET /repos/{owner}/{repo}/issues/comments/{comment_id}';
  const name = repositoryOf(fullName);
  if (name === null) {
    return Promise.resolve(null);
  }
  return readOrNull(
    channel,
    route,
    () => channel.octokit.request(route, { ...name, comment_id: commentId, headers }),
    issueCommentSchema,
  );
}

/** The first page of `GET /repos/{owner}/{repo}/commits/{commit_sha}/pulls` (E07-S07); empty for a commit that does not exist. */
export async function fetchPullRequestsForCommit(
  channel: Channel,
  headers: RequestHeaders,
  fullName: string,
  headSha: string,
): Promise<GitHubPullRequestRef[]> {
  const route = 'GET /repos/{owner}/{repo}/commits/{commit_sha}/pulls';
  const name = repositoryOf(fullName);
  if (name === null || !COMMIT_SHA.test(headSha)) {
    return [];
  }
  const found = await readOrNull(
    channel,
    route,
    () => channel.octokit.request(route, { ...name, commit_sha: headSha, per_page: PER_PAGE, headers }),
    pullRequestRefPageSchema,
  );
  return found ?? [];
}

/**
 * `PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}` (E09-S06): the comment now reads `body`.
 * @throws GitHubNotFoundError for a name GitHub cannot hold, without a request.
 */
export async function patchIssueComment(
  channel: Channel,
  headers: RequestHeaders,
  target: { readonly fullName: string; readonly commentId: GithubId },
  body: string,
): Promise<GitHubIssueComment> {
  const route = 'PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}';
  const name = checked(route, target.fullName);
  const page = await channel.send(route, () =>
    channel.octokit.request(route, { ...name, comment_id: target.commentId, body, headers }),
  );
  return parseOne(route, issueCommentSchema, page.data);
}
