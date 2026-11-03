// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Logger } from 'pino';
import { GitHubForbiddenError, GitHubNotFoundError, GitHubUnprocessableError } from '../ports/github-errors.ts';
import type { RunTarget } from '../ports/reporter.ts';
import { reportIds } from './report-record.ts';

// What becomes of a failure to write the pull request comment (E09-S06). The comment is never worth a Check Run: a 403 (the
// App lacks `Pull requests: write`), a 404 (the comment or the conversation is gone) and a 422 (a locked conversation, an
// archived repository) are logged as `comment_skipped` with the status, and the report goes on. A rate limit, an outage and a
// refused credential are thrown unchanged, for the queue to retry.

/** The status of a refusal that only costs the comment, or undefined for any other error. */
function refusalStatus(error: unknown): number | undefined {
  if (error instanceof GitHubForbiddenError) {
    return 403;
  }
  if (error instanceof GitHubNotFoundError) {
    return 404;
  }
  return error instanceof GitHubUnprocessableError ? 422 : undefined;
}

/**
 * Runs `write`, a call that changes the comment of `target`, and logs `comment_skipped` instead of failing when GitHub refuses it.
 * @returns whether the comment was written.
 * @throws what `write` throws other than a 403, 404 or 422.
 */
export async function writeCommentSoftly(
  logger: Logger,
  target: RunTarget,
  write: () => Promise<unknown>,
): Promise<boolean> {
  try {
    await write();
    return true;
  } catch (error) {
    const statusCode = refusalStatus(error);
    if (statusCode === undefined) {
      throw error;
    }
    logger.warn({ ...reportIds(target), statusCode }, 'comment_skipped');
    return false;
  }
}
