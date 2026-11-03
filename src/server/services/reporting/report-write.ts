// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../../shared/github-id.ts';
import { GitHubUnprocessableError } from '../ports/github-errors.ts';
import { ReportRejectedError, type RunTarget } from '../ports/reporter.ts';
import type { UpsertRequest } from './check-run-writer.ts';
import type { CheckRunReporterOptions } from './report-options.ts';
import { reportIds } from './report-record.ts';
import { locationOf } from './report-situation.ts';

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

/**
 * Writes `request` as {@link writeRun} does, for a head SHA that other pull requests stand at, and then brings the newest run of
 * this App on the SHA to the same view when it is not the run just written. Two pull requests that start at the same moment can
 * each create a run; each then finishes its own, and the newer one, the one GitHub shows and gates the merge on, would stay as the
 * last writer to it left it. A view that is still `in_progress` converges nothing: the pull request that is still running settles
 * the runs when it finishes. The recorded id stays the one of the run just written.
 * @throws what {@link writeRun} throws, and what the GitHub port throws for the listing.
 */
export async function writeSharedRun(
  options: CheckRunReporterOptions,
  target: RunTarget,
  request: UpsertRequest,
): Promise<GithubId> {
  const checkRunId = await writeRun(options, target, request);
  if (request.view.kind !== 'in_progress') {
    const newest = await options.writer.find(locationOf(target));
    if (newest !== null && newest.id !== checkRunId) {
      await writeRun(options, target, { ...request, known: newest });
    }
  }
  return checkRunId;
}
