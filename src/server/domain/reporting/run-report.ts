// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { CheckView } from './check-view.ts';
import type { CommentContent } from './comment-body.ts';
import { type CountedEvaluation, coverageCounts } from './coverage-counts.ts';
import type { FailureRequest } from './failure-input.ts';
import { failureReport } from './failure-report.ts';

// E09-S05: what the Check Run of a head SHA says when a pull request publishes its verdict. The run belongs to the SHA, and
// several open pull requests can share one, so the run's conclusion is the worst `result` among their rows (`failure` over
// `in_progress` over `success`); each pull request keeps its own row and its own comment (E09-S07), which says what its own
// evaluation found whatever the other pull requests at the SHA are doing. The functions are pure: the rows of the other pull
// requests are read by the reporter and handed in as plain results.

/** The results a row of `pr_evaluations` holds, as far as this decides anything; `cancelled` (a closed pull request) counts for nothing. */
export type RowResult = 'success' | 'failure' | 'in_progress' | 'cancelled';

/** The view of the Check Run, the address of the sign page when this view is the one that links to it, and what the comment says. */
export interface RunReport {
  readonly view: CheckView;
  /** The sign link as a plain address, for the `details_url` of the Check Run; `null` when the view has none. */
  readonly signUrl: string | null;
  /** What the comment of the pull request says: this pull request's own verdict, never that of another one at the SHA. */
  readonly comment: CommentContent;
}

/** What {@link runReport} needs: a failure report's request, and the verdict (the engine's `Evaluation` has every field). */
export interface RunRequest extends FailureRequest {
  readonly evaluation: FailureRequest['evaluation'] & CountedEvaluation & { readonly outcome: 'success' | 'failure' };
}

/**
 * The Check Run of `request.headSha` as the pull request that publishes it wants it, given the results of the rows of the
 * other pull requests at that SHA. A failure of this pull request is shown whole. Otherwise a failure of another one makes the run
 * fail with no names and no link (this pull request has nothing to say about it), a pull request still being evaluated keeps
 * the run `in_progress`, and only with neither does the run pass. Each of them keeps its own row either way.
 * @throws InvalidSignLinkError, InvalidShaError, InvalidIdError as {@link failureReport} does.
 */
export function runReport(request: RunRequest, others: readonly RowResult[]): RunReport {
  const { headSha, evaluation } = request;
  if (evaluation.outcome === 'failure') {
    const { view, signUrl } = failureReport(request);
    return { view, signUrl, comment: { kind: 'failure', summary: view.summary } };
  }
  const comment: CommentContent = { kind: 'success', headSha };
  if (others.includes('failure')) {
    return { view: { kind: 'failure', headSha, unsigned: 0, unlinked: 0, summary: [] }, signUrl: null, comment };
  }
  if (others.includes('in_progress')) {
    return { view: { kind: 'in_progress', headSha }, signUrl: null, comment };
  }
  return { view: { kind: 'success', headSha, covered: coverageCounts(evaluation) }, signUrl: null, comment };
}
