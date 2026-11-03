// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { parseGithubId } from '../../../shared/github-id.ts';
import { findCommentIdForPr, hasNewerHeadRow } from '../../adapters/db/pr-evaluation-links.ts';
import { disabledCommentBody } from '../../domain/reporting/comment-body.ts';
import type { RunTarget } from '../ports/reporter.ts';
import { writeCommentSoftly } from './comment-guard.ts';
import type { CheckRunReporterOptions } from './report-options.ts';
import { reportIds } from './report-record.ts';
import type { Situation } from './report-situation.ts';

// The comment of a pull request whose repository was switched off (E09-S06): a comment that exists becomes the one-line notice
// after the marker; one that does not exist is not created. The comment is shared by every head SHA of the pull request, so a
// newer head SHA that has been evaluated writes it instead (E09-S04, `hasNewerHeadRow`).

/**
 * Rewrites the comment of the pull request of `target` to the notice that enforcement is off, when it has one.
 * @throws what the GitHub port throws other than a 403, 404 or 422 on the comment, which are logged and cost the comment only.
 */
export async function rewriteAsDisabled(
  options: CheckRunReporterOptions,
  target: RunTarget,
  situation: Situation,
): Promise<void> {
  const { db, github, logger } = options;
  const { scope, repositoryId } = situation;
  const commentId = await findCommentIdForPr(db, scope, repositoryId, target.prNumber);
  if (commentId === null) {
    return;
  }
  if (await hasNewerHeadRow(db, scope, { repositoryId, prNumber: target.prNumber, headSha: target.headSha })) {
    logger.info(reportIds(target), 'comment_skipped_stale');
    return;
  }
  const written = await writeCommentSoftly(logger, target, () =>
    github.updateIssueComment(
      target.githubInstallationId,
      target.fullName,
      parseGithubId(commentId),
      disabledCommentBody(),
    ),
  );
  if (written) {
    logger.info(reportIds(target), 'report.comment_disabled');
  }
}
