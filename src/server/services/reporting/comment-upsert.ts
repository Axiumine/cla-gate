// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type GithubId, parseGithubId } from '../../../shared/github-id.ts';
import { findCommentIdForPr, recordCommentId } from '../../adapters/db/pr-evaluation-links.ts';
import { COMMENT_MARKER, type CommentContent, commentBody } from '../../domain/reporting/comment-body.ts';
import type { GitHubIssueComment } from '../ports/github.ts';
import { GitHubNotFoundError } from '../ports/github-errors.ts';
import type { RunTarget } from '../ports/reporter.ts';
import { writeCommentSoftly } from './comment-guard.ts';
import type { CheckRunReporterOptions } from './report-options.ts';
import { linkKeyOf, reportIds } from './report-record.ts';
import type { Situation } from './report-situation.ts';

// The one comment of a pull request (E09-S07), edited in place from `Pull requests: write` only. A failure writes the sign link and
// the exact fix steps; a pass rewrites a comment that exists to one sentence and never opens one, because the Check Run is the signal
// of a pull request that never failed. The comment is found in this order: the id the database holds for the pull request (a new
// head SHA keeps editing the comment of the earlier ones); then the oldest comment of the conversation that begins with the
// marker AND that GitHub says was posted through this App (a comment anyone else forged, the marker included, fails the second
// test); then, for a failure only, a new comment. The id found or created is stored. A comment that GitHub refuses (403, 404,
// 422) costs the comment only (comment-guard.ts), and a human edit is overwritten by the next evaluation.

/** The most pages of 100 comments the search for the comment of the platform reads: a conversation longer than that gets a new comment. */
const MAX_COMMENT_PAGES = 5;

/** What {@link upsertComment} is asked to write. */
export interface CommentRequest {
  readonly content: CommentContent;
  /** A newer head SHA of the pull request has been evaluated (E09-S04, `hasNewerHeadRow`, asked before any write of this report). */
  readonly stale: boolean;
}

/** The comment GitHub says this App posted and that begins with the marker. */
function isOurs(comment: GitHubIssueComment, appId: GithubId): boolean {
  return comment.appId === appId && comment.body.startsWith(COMMENT_MARKER);
}

/** The id of the oldest comment of the platform in the first {@link MAX_COMMENT_PAGES} pages of the conversation, or null. GitHub lists oldest first. */
async function findOurs(options: CheckRunReporterOptions, target: RunTarget, page = 1): Promise<GithubId | null> {
  const { github, appId } = options;
  const listed = await github.listIssueComments(target.githubInstallationId, target.fullName, target.prNumber, page);
  const ours = listed.comments.find((comment) => isOurs(comment, appId));
  if (ours !== undefined) {
    return ours.id;
  }
  return listed.last || page >= MAX_COMMENT_PAGES ? null : findOurs(options, target, page + 1);
}

/** Rewrites the comment `commentId` to `body`, or answers null when GitHub does not have it (the comment was deleted). */
async function rewrite(
  options: CheckRunReporterOptions,
  target: RunTarget,
  update: { readonly commentId: GithubId; readonly body: string },
): Promise<GithubId | null> {
  try {
    const { githubInstallationId, fullName } = target;
    return (await options.github.updateIssueComment(githubInstallationId, fullName, update.commentId, update.body)).id;
  } catch (error) {
    if (error instanceof GitHubNotFoundError) {
      return null;
    }
    throw error;
  }
}

/** What the write did: the id of the comment, and whether it was opened by this write. */
interface Written {
  readonly commentId: GithubId;
  readonly created: boolean;
}

/**
 * Edits the comment of the pull request, in the order of the file header, or opens one for a failure.
 * @returns what was written, or null when there was nothing to edit and the content is a pass.
 */
async function put(
  options: CheckRunReporterOptions,
  target: RunTarget,
  situation: Situation,
  content: CommentContent,
): Promise<Written | null> {
  const { db, github } = options;
  const { githubInstallationId, fullName, prNumber } = target;
  const body = commentBody(content);
  const stored = await findCommentIdForPr(db, situation.scope, situation.repositoryId, prNumber);
  const edited = stored === null ? null : await rewrite(options, target, { commentId: parseGithubId(stored), body });
  if (edited !== null) {
    return { commentId: edited, created: false };
  }
  const found = await findOurs(options, target);
  if (found !== null) {
    return {
      commentId: (await github.updateIssueComment(githubInstallationId, fullName, found, body)).id,
      created: false,
    };
  }
  if (content.kind === 'success') {
    return null;
  }
  return {
    commentId: (await github.createIssueComment(githubInstallationId, fullName, prNumber, body)).id,
    created: true,
  };
}

/**
 * Writes the comment of the pull request of `target` for `request.content`, after the Check Run, which this never undoes. A newer
 * head SHA that has been evaluated writes the comment instead (`comment_skipped_stale`).
 * @throws what the GitHub port throws other than a 403, 404 or 422 on the comment, which are logged and cost the comment only.
 */
export async function upsertComment(
  options: CheckRunReporterOptions,
  target: RunTarget,
  situation: Situation,
  request: CommentRequest,
): Promise<void> {
  const { db, logger } = options;
  if (request.stale) {
    logger.info(reportIds(target), 'comment_skipped_stale');
    return;
  }
  await writeCommentSoftly(logger, target, async () => {
    const written = await put(options, target, situation, request.content);
    if (written === null) {
      return;
    }
    await recordCommentId(db, situation.scope, linkKeyOf(target, situation), written.commentId);
    logger.info(
      { ...reportIds(target), commentId: written.commentId },
      written.created ? 'report.comment_created' : 'report.comment_updated',
    );
  });
}
