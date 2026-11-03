// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../../shared/github-id.ts';
import type { GitHubIssueComment, GitHubPullRequestRef } from '../../services/ports/github.ts';
import { COMMIT_SHA, PER_PAGE, repositoryOf } from './octokit-names.ts';
import { type Channel, type RequestHeaders, readOrNull } from './octokit-request.ts';
import { issueCommentSchema, pullRequestRefPageSchema } from './schemas.ts';

// The requests of the manual re-evaluation (E07-S07): a comment, and the pull requests GitHub associates with a commit. They are made
// with an installation's token, so `headers` carry it, and nothing that cannot be a name or a SHA reaches a path. The calls on the
// comment the platform keeps are in octokit-conversation-calls.ts.

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
