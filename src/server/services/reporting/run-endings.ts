// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { CheckView } from '../../domain/reporting/check-view.ts';
import type { ReportFailureCode, RunTarget } from '../ports/reporter.ts';
import { rewriteAsDisabled } from './disabled-comment.ts';
import type { CheckRunReporterOptions } from './report-options.ts';
import { logReport, reportIds } from './report-record.ts';
import { locatorOf, readSituation } from './report-situation.ts';
import { writeRun } from './report-write.ts';

// The three ways a Check Run ends other than with a verdict (E09-S06): the evaluation could not be completed, the pull request
// was closed, and the maintainers turned enforcement off. None of them writes a `pr_evaluations` column: the rows are the job's
// (E07-S05, E07-S06) and the id of the run was recorded by `started` and `publish`. Each repeats safely.

/** The view each code of a failure shows. */
const FAILURE_VIEWS: Readonly<Record<ReportFailureCode, CheckView>> = {
  evaluation_failed: { kind: 'evaluation_failed' },
};

/**
 * Completes the Check Run of the head SHA with `failure` and the sentence that sends the contributor to `/recheck`; a SHA with no
 * run gets one that is already completed. No comment is written.
 * @throws TenantMismatchError, EvaluationRowMissingError and what the GitHub port and the writer throw.
 */
export async function reportFailed(
  options: CheckRunReporterOptions,
  target: RunTarget,
  code: ReportFailureCode,
): Promise<void> {
  const situation = await readSituation(options.db, target);
  const checkRunId = await writeRun(options, target, {
    ...locatorOf(target, situation.own),
    // eslint-disable-next-line security/detect-object-injection -- code is the closed ReportFailureCode union, never user input
    view: FAILURE_VIEWS[code],
    externalId: String(target.evaluationId),
  });
  logReport(options.logger, target, checkRunId, 'report.failed');
}

/**
 * Completes the Check Run of the head SHA with `cancelled` when it is still running. A completed run is left as it is, and a SHA
 * with no run has nothing to cancel: neither is a reason to create one. No comment is written.
 * @throws TenantMismatchError, EvaluationRowMissingError and what the GitHub port and the writer throw.
 */
export async function reportCancelled(options: CheckRunReporterOptions, target: RunTarget): Promise<void> {
  const situation = await readSituation(options.db, target);
  const locator = locatorOf(target, situation.own);
  const run = await options.writer.find(locator);
  if (run === null || run.status === 'completed') {
    options.logger.info({ ...reportIds(target), checkRunId: run?.id ?? null }, 'report.cancel_not_needed');
    return;
  }
  const checkRunId = await writeRun(options, target, {
    ...locator,
    known: run,
    view: { kind: 'cancelled' },
    externalId: String(target.evaluationId),
  });
  logReport(options.logger, target, checkRunId, 'report.cancelled');
}

/**
 * Completes the Check Run of the head SHA with `neutral` and the sentence that enforcement is off, then rewrites the comment of the
 * pull request to the one-line notice when it has one. The Check Run is written first and is never undone by the comment.
 * @throws TenantMismatchError, EvaluationRowMissingError and what the GitHub port and the writer throw.
 */
export async function reportEnforcementDisabled(options: CheckRunReporterOptions, target: RunTarget): Promise<void> {
  const situation = await readSituation(options.db, target);
  const checkRunId = await writeRun(options, target, {
    ...locatorOf(target, situation.own),
    view: { kind: 'enforcement_disabled' },
    externalId: String(target.evaluationId),
  });
  logReport(options.logger, target, checkRunId, 'report.enforcement_disabled');
  await rewriteAsDisabled(options, target, situation);
}
