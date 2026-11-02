// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../../shared/github-id.ts';
import type { Evaluation } from '../../domain/evaluation/index.ts';
import type { JobEnvelope } from '../../domain/job-envelope.ts';

// What the evaluation job (E07-S04) needs of the code that writes the Check Run and the pull request comment. The reporter
// is E09: this file is the port the job calls, `FakeReporter` (`services/evaluate-pr/test-support.ts`) the double the job is
// tested with, and E09-S05 the implementation the composition root binds. A later story adds its method here with its row
// in the fake (`failed` came with E07-S05, `cancelled` with E07-S06).

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
 * The pull request and head SHA a cancellation is about (E07-S06): a {@link ReportTarget} without the trigger, which says why
 * an evaluation ran and which a pull request that was closed has none of.
 */
type CancelTarget = Omit<ReportTarget, 'trigger'>;

/** Why an evaluation could not complete: the closed set E09 renders (`evaluation_failed`: the retries of the job are spent). */
type ReportFailureCode = 'evaluation_failed';

export interface EvaluationReporter {
  /** The evaluation of `target` began: its Check Run is `in_progress`. Safe to call again after a crash. */
  started(target: ReportTarget): Promise<void>;

  /**
   * The verdict on `target`, which the job has stored already. Called once per evaluation that was not superseded; a retry
   * of the job calls it again, so it must be idempotent.
   */
  publish(target: ReportTarget, evaluation: Evaluation): Promise<void>;

  /**
   * The evaluation of `target` could not be completed and will not be retried by the queue (E07-S05): the Check Run of its
   * head SHA ends `failure`, with a summary that tells the contributor to comment `/recheck`. Writes no comment and no
   * `pr_evaluations` column; the job sets the row. Called again when the dead-letter handler is retried, so it must be idempotent.
   */
  failed(target: ReportTarget, code: ReportFailureCode): Promise<void>;

  /**
   * The pull request of `target` was closed (merged or not) while its evaluation was in progress (E07-S06): the Check Run of
   * its head SHA ends with the conclusion `cancelled`, so no check hangs on a closed pull request. A run that is completed
   * already is left as it is. Writes no comment and no `pr_evaluations` column; the job sets the row. Called again when the
   * job is retried, so it must be idempotent.
   */
  cancelled(target: CancelTarget): Promise<void>;
}
