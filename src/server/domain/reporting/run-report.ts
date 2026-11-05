// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { CheckView, CoverageCounts } from './check-view.ts';
import type { CommentContent } from './comment-body.ts';
import { type CountedEvaluation, coverageCounts } from './coverage-counts.ts';
import type { FailureRequest } from './failure-input.ts';
import { failureReport } from './failure-report.ts';

// E09-S05: what the Check Run of a head SHA says when a pull request publishes its verdict. The run belongs to the SHA, and
// several open pull requests can share one, so the run's conclusion is the worst `result` among their rows (`failure` over
// `in_progress` over `success`); the rows of pull requests that are closed, or whose head moved on, count for nothing. Each pull
// request keeps its own row and its own comment (E09-S07), which says what its own evaluation found whatever the other pull
// requests at the SHA are doing. The functions are pure: the rows of the other pull requests are read by the reporter (which
// leaves out the closed ones) and handed in as plain results.

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
 * What the Check Run of a head SHA says when no failure of the pull request that writes it is to be shown, given the results of
 * the rows of the other pull requests that are open at the SHA: a failure of one of them makes the run fail, with no names and no
 * link (this pull request has nothing to say about it), one still being evaluated keeps it `in_progress`, and only with neither
 * does it pass, with `covered` as its counts. `cancelled` rows count for nothing.
 */
export function sharedView(headSha: string, others: readonly RowResult[], covered: CoverageCounts): CheckView {
  if (others.includes('failure')) {
    return { kind: 'failure', headSha, unsigned: 0, unlinked: 0, summary: [] };
  }
  if (others.includes('in_progress')) {
    return { kind: 'in_progress', headSha };
  }
  return { kind: 'success', headSha, covered };
}

/**
 * The Check Run of `request.headSha` as the pull request that publishes it wants it, given the results of the rows of the
 * other pull requests open at that SHA. A failure of this pull request is shown whole. Otherwise the run is {@link sharedView}
 * of the others, with the counts of this pull request's own evaluation. Each of them keeps its own row either way.
 * @throws InvalidSignLinkError, InvalidShaError, InvalidIdError as {@link failureReport} does.
 */
export function runReport(request: RunRequest, others: readonly RowResult[]): RunReport {
  const { headSha, evaluation } = request;
  if (evaluation.outcome === 'failure') {
    const { view, signUrl } = failureReport(request);
    return { view, signUrl, comment: { kind: 'failure', summary: view.summary } };
  }
  const covered = coverageCounts(evaluation);
  const view = sharedView(headSha, others, covered);
  return { view, signUrl: null, comment: { kind: 'success', headSha, corporate: covered.corporate } };
}
