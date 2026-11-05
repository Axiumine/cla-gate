// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { countedPhrases, coverageSentence, renderCheckOutput } from './check-output.ts';
import type { CheckOutput, CheckView } from './check-view.ts';
import { shortSha } from './encode.ts';

// E09-S06: what a Check Run is given when GitHub answers 422 to the full output. The run still has to end: the conclusion is
// always sent, so text GitHub will not take never leaves a run pending. The minimal output keeps the status, the conclusion and
// the title of the view, and swaps the summary for one of at most 500 characters (the counts, the head SHA and the `/recheck` hint
// are all it holds, so the cap follows from the text, not from a check). It names no one and carries no `text`.

const RECHECK_HINT = 'Comment `/recheck` to run it again.';

/** The summary of a failure that lost its sections: the counts, the commit and the hint. */
function failureNote(view: Extract<CheckView, { kind: 'failure' }>): string {
  const counts = countedPhrases([
    [view.unsigned, 'unsigned'],
    [view.unlinked, 'unlinked'],
  ]);
  const detail = counts.length === 0 ? '' : ` (${counts.join(', ')})`;
  return `The CLA check did not pass for commit ${shortSha(view.headSha)}${detail}. The details could not be shown here. ${RECHECK_HINT}`;
}

/**
 * The output of `view` with a summary that holds the counts and the `/recheck` hint and nothing a person wrote. A view that
 * names no one already (in progress, cancelled, disabled, could not complete, a merge group, E22-S01) keeps its fixed summary.
 * @throws InvalidShaError and InvalidIdError as {@link renderCheckOutput} does.
 */
export function minimalCheckOutput(view: CheckView): CheckOutput {
  switch (view.kind) {
    case 'success':
      return { ...renderCheckOutput(view), summary: `${coverageSentence(view.covered)} ${RECHECK_HINT}` };
    case 'failure':
      return { ...renderCheckOutput({ ...view, summary: [], text: [] }), summary: failureNote(view) };
    case 'in_progress':
    case 'cancelled':
    case 'enforcement_disabled':
    case 'evaluation_failed':
    case 'merge_group':
      return renderCheckOutput(view);
  }
}
