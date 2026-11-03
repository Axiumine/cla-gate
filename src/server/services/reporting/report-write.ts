// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../../shared/github-id.ts';
import { GitHubUnprocessableError } from '../ports/github-errors.ts';
import { ReportRejectedError, type RunTarget } from '../ports/reporter.ts';
import type { UpsertRequest } from './check-run-writer.ts';
import type { CheckRunReporterOptions } from './report-options.ts';
import { reportIds } from './report-record.ts';

// The write of a Check Run with the fallback of E09-S06: when GitHub answers 422 to the full output (a body it will not take),
// the write is repeated once with the minimal output, which holds the counts and the `/recheck` hint and no name. The conclusion
// is sent either way, so text GitHub refuses never leaves a run pending. A 422 to the minimal output is the end of it.

/**
 * Writes `request` to the Check Run of the head SHA and returns the id of the run that now holds it.
 * @throws ReportRejectedError (`output_rejected`) when GitHub refuses the minimal output too, and what the writer throws otherwise.
 */
export async function writeRun(
  options: CheckRunReporterOptions,
  target: RunTarget,
  request: UpsertRequest,
): Promise<GithubId> {
  const { writer, logger } = options;
  try {
    return (await writer.upsert(request)).checkRunId;
  } catch (error) {
    if (!(error instanceof GitHubUnprocessableError)) {
      throw error;
    }
    logger.warn({ ...reportIds(target), statusCode: 422 }, 'report.output_rejected');
  }
  try {
    return (await writer.upsert({ ...request, minimal: true })).checkRunId;
  } catch (error) {
    if (error instanceof GitHubUnprocessableError) {
      logger.error({ ...reportIds(target), statusCode: 422 }, 'report.minimal_output_rejected');
      throw new ReportRejectedError('output_rejected');
    }
    throw error;
  }
}
