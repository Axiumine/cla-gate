// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Evaluation } from '../../domain/evaluation/index.ts';
import type { MergeGroupResult } from '../../domain/reporting/check-view.ts';
import type { DisplayNames } from '../../domain/reporting/display-names.ts';
import type {
  EvaluationReporter,
  MergeGroupTarget,
  ReportFailureCode,
  ReportOutcome,
  ReportTarget,
  RunTarget,
} from '../ports/reporter.ts';
import { reportMergeGroup } from './merge-group-report.ts';
import { guardReport } from './report-guard.ts';
import type { CheckRunReporterOptions } from './report-options.ts';
import { reportCancelled, reportEnforcementDisabled, reportFailed } from './run-endings.ts';
import { reportPublished, reportStarted } from './run-lifecycle.ts';

// The reporter of the evaluation job (E09-S05, E09-S06): `started` makes sure the head SHA has a Check Run that is `in_progress`,
// `publish` writes the verdict to it (run-lifecycle.ts), and `failed`, `cancelled` and `enforcementDisabled` end it otherwise
// (run-endings.ts), so
// that no check stays `in_progress` for good. The run belongs to the head SHA, not to the pull request: the SHA written is always
// `target.headSha`, never one read elsewhere (the job re-checks the head before it publishes, and a newer job overwriting an
// older one is accepted, E07-S04), and the reporter never asks GitHub for the pull request. Two pull requests can share a head
// SHA; the same pull request is serialised by the queue (E07-S02), so the reporter takes no lock. The id of the run is kept on
// the row of the pull request (E09-S04). What GitHub answers is mapped in one place (report-guard.ts) and the write falls back to
// a minimal output on a 422 (report-write.ts).

export class CheckRunReporter implements EvaluationReporter {
  readonly #options: CheckRunReporterOptions;

  constructor(options: CheckRunReporterOptions) {
    this.#options = options;
  }

  /**
   * The evaluation of `target` began: no run on the SHA means a new `in_progress` run, with the id of the row as its external id;
   * a run that is not completed is reused untouched (a job retried after a crash between the create and the database write makes
   * no second run); a completed run is left as it is, so the previous verdict stays visible until the final write, except for a
   * person's request to run it again (`check_rerequested`, `recheck`), which gets a fresh `in_progress` run.
   * @throws TenantMismatchError for an installation or repository the database does not hold together, EvaluationRowMissingError
   * when the row of the pull request at the SHA does not exist, ReportRejectedError (see the port), and what the GitHub port
   * throws other than a missing repository or installation, which end in a skipped outcome.
   */
  started(target: ReportTarget): Promise<ReportOutcome> {
    return guardReport(this.#options.logger, target, () => reportStarted(this.#options, target));
  }

  /**
   * The verdict on `target`, which the job has stored. The run is the one the row records (a missing or vanished one is
   * created already completed, see the writer). Its view is this pull request's own, unless another pull request at the same SHA
   * is failing or still being evaluated, which is then what the run says (`failure` over `in_progress` over `success`).
   * @throws TenantMismatchError, EvaluationRowMissingError, InvalidSignLinkError for a base URL that cannot make a sign link,
   * ReportRejectedError, and what the GitHub port throws other than a missing repository or installation.
   */
  publish(target: ReportTarget, evaluation: Evaluation, names: DisplayNames): Promise<ReportOutcome> {
    return guardReport(this.#options.logger, target, () => reportPublished(this.#options, target, evaluation, names));
  }

  /**
   * The evaluation of `target` could not be completed: the run ends `failure` with the sentence that sends the contributor to
   * `/recheck`. No comment and no `pr_evaluations` column is written.
   * @throws as {@link CheckRunReporter.publish} does.
   */
  failed(target: ReportTarget, code: ReportFailureCode): Promise<ReportOutcome> {
    return guardReport(this.#options.logger, target, () => reportFailed(this.#options, target, code));
  }

  /**
   * The pull request of `target` was closed: a run that is still running ends `cancelled`; a completed run is left as it is. A run
   * that another open pull request at the SHA shares is not cancelled: it is left to the one still being evaluated, or completed
   * with what the remaining rows say.
   * @throws as {@link CheckRunReporter.publish} does.
   */
  cancelled(target: RunTarget): Promise<ReportOutcome> {
    return guardReport(this.#options.logger, target, () => reportCancelled(this.#options, target));
  }

  /**
   * Enforcement is off for the repository of `target`: the run ends `neutral`, and a comment that exists becomes the one-line
   * notice. The Check Run comes first and a comment that GitHub refuses (403, 404, 422) costs the comment only.
   * @throws as {@link CheckRunReporter.publish} does.
   */
  enforcementDisabled(target: RunTarget): Promise<ReportOutcome> {
    return guardReport(this.#options.logger, target, () => reportEnforcementDisabled(this.#options, target));
  }

  /**
   * The verdict on a merge group (E22-S01): the run of the group's head SHA is written through the same upsert, completed with the
   * conclusion `result` gives, and the id of the run is recorded on the row of the group.
   * @throws TenantMismatchError, GroupRowMissingError, ReportRejectedError, and what the GitHub port throws other than a missing
   * repository or installation.
   */
  mergeGroup(target: MergeGroupTarget, result: MergeGroupResult): Promise<ReportOutcome> {
    return guardReport(this.#options.logger, target, () => reportMergeGroup(this.#options, target, result));
  }
}
