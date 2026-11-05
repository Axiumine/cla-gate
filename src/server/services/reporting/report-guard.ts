// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Logger } from 'pino';
import { MergeGroupDestroyedError } from '../merge-group/merge-group-rows.ts';
import { GitHubForbiddenError, GitHubNotFoundError } from '../ports/github-errors.ts';
import { isInstallationUnavailable } from '../ports/installation-unavailable.ts';
import { type ReportOutcome, ReportRejectedError, type ReportSkipReason } from '../ports/reporter.ts';
import { type LoggedRun, reportIds } from './report-record.ts';

// What becomes of what GitHub answers to a report (E09-S06). A rate limit, an outage and a refused credential leave as they
// are, for the queue to retry; a repository GitHub no longer has and an installation that is not served end the report as a
// skip, which is an answer and never a throw; a missing `Checks: write` permission ends in a ReportRejectedError. The 422 is
// the writer's business (report-write.ts), because it has something to retry with. Logs carry numeric ids, the head SHA and a
// status code, never a name, a token or a body.

const REPORTED: ReportOutcome = { status: 'reported' };

/** Why the report cannot be made at all, or undefined when the error is another kind. */
function skipReason(error: unknown): ReportSkipReason | undefined {
  if (error instanceof GitHubNotFoundError) {
    return 'repository_gone';
  }
  if (error instanceof MergeGroupDestroyedError) {
    return 'merge_group_destroyed';
  }
  return isInstallationUnavailable(error) ? 'installation_unavailable' : undefined;
}

/**
 * Runs `work`, the report of `target`, and says how it ended.
 * @returns `reported`, or `skipped` with the reason for a repository GitHub no longer has, for an installation that is not served
 * and for a merge group GitHub took down (E22-S01).
 * @throws ReportRejectedError (`checks_permission_missing`) when GitHub answers 403 to a Check Run call; everything else is rethrown unchanged.
 */
export async function guardReport(
  logger: Logger,
  target: LoggedRun,
  work: () => Promise<void>,
): Promise<ReportOutcome> {
  try {
    await work();
    return REPORTED;
  } catch (error) {
    const reason = skipReason(error);
    if (reason !== undefined) {
      logger.warn({ ...reportIds(target), reason }, 'report.skipped');
      return { status: 'skipped', reason };
    }
    if (error instanceof GitHubForbiddenError) {
      logger.error({ ...reportIds(target), statusCode: 403 }, 'checks_permission_missing');
      throw new ReportRejectedError('checks_permission_missing');
    }
    throw error;
  }
}
