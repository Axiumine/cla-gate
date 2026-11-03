// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { CheckView } from '../../domain/reporting/check-view.ts';
import type { ReportFailureCode, RunTarget } from '../ports/reporter.ts';
import { rewriteAsDisabled } from './disabled-comment.ts';
import type { CheckRunReporterOptions } from './report-options.ts';
import { logReport, reportIds } from './report-record.ts';
import { locatorOf, readSituation } from './report-situation.ts';
import { writeRun, writeSharedRun } from './report-write.ts';
import { liveSiblings, settledView } from './shared-sha.ts';

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
 * Ends the Check Run of the head SHA of a pull request that was closed (or whose head moved on) while the run is still running.
 * A completed run is left as it is, and a SHA with no run has nothing to cancel: neither is a reason to create one. When no other
 * pull request is open at the SHA the run ends `cancelled`. When one is, the run is not this pull request's alone: it is left
 * running if another one is still being evaluated (that one finishes it), and otherwise it is completed with what the remaining
 * rows say (see {@link settledView}), because a pull request that finished while this one was running left the run `in_progress`
 * for this one's end to settle, and nothing publishes for it again. No comment is written.
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
  const siblings = await liveSiblings(options, target, situation);
  if (siblings.length === 0) {
    const checkRunId = await writeRun(options, target, {
      ...locator,
      known: run,
      view: { kind: 'cancelled' },
      externalId: String(target.evaluationId),
    });
    logReport(options.logger, target, checkRunId, 'report.cancelled');
    return;
  }
  const view = settledView(target.headSha, siblings);
  if (view.kind === 'in_progress') {
    options.logger.info({ ...reportIds(target), checkRunId: run.id }, 'report.cancel_left_to_sibling');
    return;
  }
  const checkRunId = await writeSharedRun(options, target, { ...locator, known: run, view });
  logReport(options.logger, target, checkRunId, 'report.settled_for_siblings');
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
