// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type GithubId, parseGithubId } from '../../../shared/github-id.ts';
import type { GitHubIssueComment, GitHubIssueCommentPage } from '../ports/github.ts';

// The comments a GitHub in memory posts and lists (E09-S07), shared by `FakeGitHub` and by the mocked GitHub of the Octokit
// adapter's tests, so that both answer one set of rules: a comment gets the next id, is posted by the App as a bot, belongs to the
// issue it was posted on, and a listing is the comments of one issue, oldest (lowest id) first, 100 to a page.

/** Comments per page of a listing: the most GitHub gives. */
const COMMENTS_PER_PAGE = 100;

/** The account GitHub shows as the author of a comment an App posts: a bot, with an id of its own. */
const APP_BOT: NonNullable<GitHubIssueComment['author']> = { id: parseGithubId(8_800_001), type: 'Bot' };

/** Hands out the ids of the comments the world posts, in order. */
export class CommentIds {
  #next = 8_000_001;

  take(): GithubId {
    const id = parseGithubId(this.#next);
    this.#next += 1;
    return id;
  }
}

/** The comment the App `appId` posts as `id` on the issue `issueNumber`. */
export function postedComment(
  posted: { readonly id: GithubId; readonly issueNumber: number; readonly appId: GithubId },
  body: string,
): GitHubIssueComment {
  return { id: posted.id, issueNumber: posted.issueNumber, body, author: APP_BOT, appId: posted.appId };
}

/**
 * The comments of the issue `issueNumber` among `comments`, oldest (lowest id) first. `prefix` is the part of a key that
 * names the repository of an installation: `<installation>/<owner/name in lower case>/comments/`.
 */
export function commentsOfIssue(
  comments: ReadonlyMap<string, GitHubIssueComment>,
  prefix: string,
  issueNumber: number,
): GitHubIssueComment[] {
  return [...comments]
    .filter(([key, comment]) => key.startsWith(prefix) && comment.issueNumber === issueNumber)
    .map(([, comment]) => comment)
    .toSorted((a, b) => a.id - b.id);
}

/** Page `page` (1-based, 100) of `comments`, with whether it is the last. */
export function pageOfComments(comments: readonly GitHubIssueComment[], page: number): GitHubIssueCommentPage {
  const from = (page - 1) * COMMENTS_PER_PAGE;
  return {
    comments: comments.slice(from, from + COMMENTS_PER_PAGE),
    last: from + COMMENTS_PER_PAGE >= comments.length,
  };
}
