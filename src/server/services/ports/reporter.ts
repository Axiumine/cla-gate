// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../../shared/github-id.ts';
import type { Evaluation } from '../../domain/evaluation/index.ts';
import type { JobEnvelope } from '../../domain/job-envelope.ts';
import type { MergeGroupResult } from '../../domain/reporting/check-view.ts';
import type { DisplayNames } from '../../domain/reporting/display-names.ts';

// What the evaluation job (E07-S04) needs of the code that writes the Check Run and the pull request comment. The reporter
// is E09: this file is the port the job calls, `FakeReporter` (`services/evaluate-pr/test-support.ts`) the double the job is
// tested with, and E09-S05 and E09-S06 the implementation the composition root binds. A later story adds its method here with
// its row in the fake (`failed` came with E07-S05, `cancelled` with E07-S06, `enforcementDisabled` with E09-S06).

/** Why an `evaluate-pr` job runs: the closed set of its envelope. */
type EvaluationTrigger = Extract<JobEnvelope, { type: 'evaluate-pr' }>['trigger'];

/**
 * The pull request and head SHA a report is about. Every report is for one head SHA, because the Check Run is per head SHA:
 * the SHA written is always `headSha`, never one the reporter read elsewhere.
 */
export interface ReportTarget {
  readonly githubInstallationId: GithubId;
  readonly githubRepoId: GithubId;
  /** `owner/name` as GitHub shows the repository now (a display snapshot; the ids are the identity). */
  readonly fullName: string;
  readonly prNumber: number;
  readonly headSha: string;
  readonly trigger: EvaluationTrigger;
  /** The id of the `pr_evaluations` row of this head SHA, which the Check Run carries as its external id. */
  readonly evaluationId: number;
}

/**
 * The pull request and head SHA a report on an existing run is about (E07-S06, E09-S06): a {@link ReportTarget} without the
 * trigger, which says why an evaluation ran and which a pull request that was closed, or whose repository was switched off, has
 * none of.
 */
export type RunTarget = Omit<ReportTarget, 'trigger'>;

/**
 * The merge group a report is about (E22-S01): the head SHA of the group, whose Check Run is the one a merge queue waits for. A
 * group has no pull request and no `pr_evaluations` row, so the target has neither; the row of the group is found by the ids.
 */
export type MergeGroupTarget = Pick<RunTarget, 'githubInstallationId' | 'githubRepoId' | 'fullName' | 'headSha'>;

/**
 * Why a report was not made and will not be: GitHub no longer has the repository (`repository_gone`), the instance does not
 * serve the installation (`installation_unavailable`: uninstalled, suspended or not admitted), or GitHub took the merge group
 * down (`merge_group_destroyed`, E22-S01). Retrying cannot help any of them.
 */
export type ReportSkipReason = 'repository_gone' | 'installation_unavailable' | 'merge_group_destroyed';

/** What a report came to (E09-S06): written, or skipped for a reason that retrying cannot repair. A skip is an answer, never a throw. */
export type ReportOutcome =
  | { readonly status: 'reported' }
  | { readonly status: 'skipped'; readonly reason: ReportSkipReason };

/** Why GitHub refused a report for good: the App lacks `Checks: write` (`checks_permission_missing`), or it refused the minimal output too. */
export type ReportRejection = 'checks_permission_missing' | 'output_rejected';

/** GitHub refused a report in a way the platform cannot repair by itself (E09-S06). The job fails and the queue decides; the message is fixed text. */
export class ReportRejectedError extends Error {
  override readonly name = 'ReportRejectedError';
  readonly rejection: ReportRejection;

  constructor(rejection: ReportRejection) {
    super(`GitHub refused the report (${rejection})`);
    this.rejection = rejection;
  }
}

/** Why an evaluation could not complete: the closed set E09 renders (`evaluation_failed`: the retries of the job are spent). */
export type ReportFailureCode = 'evaluation_failed';

/**
 * What every method does with what GitHub answers (E09-S06): a rate limit, an outage or a refused credential is thrown as it
 * is, for the queue to retry; a repository GitHub no longer has, or an installation that is not served, ends in a
 * `skipped` outcome; a 422 is retried once with a minimal output; a missing `Checks: write` permission, or a 422 to the minimal
 * output, throws {@link ReportRejectedError}. A report is idempotent: the job may repeat it.
 */
export interface EvaluationReporter {
  /** The evaluation of `target` began: its Check Run is `in_progress`. Safe to call again after a crash. */
  started(target: ReportTarget): Promise<ReportOutcome>;

  /**
   * The verdict on `target`, which the job has stored already. Called once per evaluation that was not superseded; a retry
   * of the job calls it again, so it must be idempotent. `names` are the logins and trailer names of the data the job fetched
   * (E09-S03): the evaluation holds numeric ids only. They are used for this report and never stored.
   */
  publish(target: ReportTarget, evaluation: Evaluation, names: DisplayNames): Promise<ReportOutcome>;

  /**
   * The evaluation of `target` could not be completed and will not be retried by the queue (E07-S05): the Check Run of its
   * head SHA ends `failure`, with a summary that tells the contributor to comment `/recheck`. Writes no comment and no
   * `pr_evaluations` column; the job sets the row. Called again when the dead-letter handler is retried, so it must be idempotent.
   */
  failed(target: ReportTarget, code: ReportFailureCode): Promise<ReportOutcome>;

  /**
   * The pull request of `target` was closed (merged or not) while its evaluation was in progress (E07-S06): the Check Run of
   * its head SHA ends with the conclusion `cancelled`, so no check hangs on a closed pull request. A run that is completed
   * already is left as it is. When another open pull request stands at the same head SHA the run is theirs too, and is not
   * cancelled (E09-S06). Writes no comment and no `pr_evaluations` column; the job sets the row. Called again when the job is
   * retried, so it must be idempotent.
   */
  cancelled(target: RunTarget): Promise<ReportOutcome>;

  /**
   * The maintainers turned CLA enforcement off for the repository of `target` (E09-S06, called by the `finalise-check` job of
   * E14-S04): the Check Run of its head SHA ends with the conclusion `neutral` and the sentence that says so, and a pull request
   * comment that exists is rewritten to a one-line notice. A comment that is not there is not created. The comment is the
   * pull request's, so a newer head SHA that has been evaluated writes it instead. Called again when the job is retried, so it
   * must be idempotent.
   */
  enforcementDisabled(target: RunTarget): Promise<ReportOutcome>;

  /**
   * The verdict on a merge group (E22-S01): its Check Run on `target.headSha` ends `success` for a group whose every pull request
   * is covered and `failure` for any other result (the output is numbers and fixed sentences only, see `result`). The run is the
   * one the row of the group records, or the newest of this App on the SHA, and a missing one is created already completed.
   * The id of the run is recorded on the row of the group. Called again when the job is retried, and by the dead-letter handler, so it must be
   * idempotent.
   */
  mergeGroup(target: MergeGroupTarget, result: MergeGroupResult): Promise<ReportOutcome>;
}
