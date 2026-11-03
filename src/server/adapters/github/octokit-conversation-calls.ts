// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../../shared/github-id.ts';
import type { GitHubIssueComment, GitHubIssueCommentPage } from '../../services/ports/github.ts';
import { checked, PER_PAGE } from './octokit-names.ts';
import { type Channel, parseOne, type RequestHeaders } from './octokit-request.ts';
import { hasNextPage } from './pagination.ts';
import { issueCommentPageSchema, issueCommentSchema } from './schemas.ts';

// The requests on the conversation of a pull request (E09-S06, E09-S07): the rewrite of a comment the platform wrote, the page of a
// conversation it looks in, and the creation of a comment. They are made with an installation's token, so `headers` carry it, and
// nothing that cannot be a name reaches a path.

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

/**
 * One page of `GET /repos/{owner}/{repo}/issues/{issue_number}/comments` (E09-S07), 100 comments, oldest first.
 * @throws GitHubNotFoundError for a name GitHub cannot hold, without a request.
 */
export async function fetchIssueCommentPage(
  channel: Channel,
  headers: RequestHeaders,
  listing: { readonly fullName: string; readonly issueNumber: number; readonly page: number },
): Promise<GitHubIssueCommentPage> {
  const route = 'GET /repos/{owner}/{repo}/issues/{issue_number}/comments';
  const name = checked(route, listing.fullName);
  const answer = await channel.send(route, () =>
    channel.octokit.request(route, {
      ...name,
      issue_number: listing.issueNumber,
      per_page: PER_PAGE,
      page: listing.page,
      headers,
    }),
  );
  return { comments: parseOne(route, issueCommentPageSchema, answer.data), last: !hasNextPage(answer.link) };
}

/**
 * `POST /repos/{owner}/{repo}/issues/{issue_number}/comments` (E09-S07): a new comment reading `body`.
 * @throws GitHubNotFoundError for a name GitHub cannot hold, without a request.
 */
export async function postIssueComment(
  channel: Channel,
  headers: RequestHeaders,
  target: { readonly fullName: string; readonly issueNumber: number },
  body: string,
): Promise<GitHubIssueComment> {
  const route = 'POST /repos/{owner}/{repo}/issues/{issue_number}/comments';
  const name = checked(route, target.fullName);
  const page = await channel.send(route, () =>
    channel.octokit.request(route, { ...name, issue_number: target.issueNumber, body, headers }),
  );
  return parseOne(route, issueCommentSchema, page.data);
}
