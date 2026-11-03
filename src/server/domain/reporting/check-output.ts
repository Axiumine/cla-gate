// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { CHECK_RUN_NAME } from '../../../shared/check.ts';
import type { CheckConclusion, CheckOutput, CheckView, CoverageCounts } from './check-view.ts';
import { InvalidIdError, renderId, shortSha } from './encode.ts';
import { renderParts } from './output-parts.ts';

// E09-S02: what the Check Run of a head SHA says, as plain data. `renderCheckOutput` is pure: the view in, the `status`,
// `conclusion` and `output` of the GitHub call out, so a test can pin every sentence a contributor reads. The view of a
// failure carries the sections that E09-S03 builds (the unsigned people, the unlinked commits, the fix steps), so no name is
// formatted here: a success, an in-progress, a cancelled and a disabled check name no one at all. The title and the fixed
// sentences are written out below and nowhere else; the limits of GitHub (a title up to 100 characters, a summary and a text up
// to 65 535 UTF-16 code units) are kept by the fixed titles and by `renderParts`.

/** The titles that never change. */
const TITLES = {
  success: 'CLA check passed',
  failure: 'CLA check failed',
  in_progress: 'Checking CLA signatures',
  cancelled: 'CLA check cancelled',
  enforcement_disabled: 'CLA enforcement is disabled for this repository',
} as const;

/** The summary of a cancelled check. */
const CANCELLED_SUMMARY = 'This pull request was closed before the check finished.';

/**
 * The summary of a check on a repository whose enforcement is off. It is the one place the sentence is written: the
 * reporter's `enforcementDisabled` (E09-S06, called by E14-S04) renders this view and adds no text of its own.
 */
export const ENFORCEMENT_DISABLED_SUMMARY =
  `The maintainers turned CLA enforcement off for this repository. If \`${CHECK_RUN_NAME}\` is a required check in branch ` +
  'protection, remove it from the required checks or ask the maintainers to re-enable enforcement.';

/** A count as text. @throws InvalidIdError for a number that is negative, fractional or not a safe integer. */
function renderCount(count: number): string {
  if (count < 0) {
    throw new InvalidIdError();
  }
  return renderId(count);
}

/** `N words` for each count that is not zero, in order. Every count is checked, the zero ones too. */
function countedPhrases(counts: readonly (readonly [count: number, words: string])[]): string[] {
  return counts.flatMap(([count, words]) => {
    const shown = renderCount(count);
    return count === 0 ? [] : [`${shown} ${words}`];
  });
}

/** `CLA signature required: N unsigned, M unlinked`, a zero count left out; `CLA check failed` when both are zero. */
function failureTitle(unsigned: number, unlinked: number): string {
  const phrases = countedPhrases([
    [unsigned, 'unsigned'],
    [unlinked, 'unlinked'],
  ]);
  return phrases.length === 0 ? TITLES.failure : `CLA signature required: ${phrases.join(', ')}`;
}

/** `4 contributors covered: 2 by signature, 1 by allowlist rule, 1 by maintainer override.`, a zero count left out. */
function coverageSentence(covered: CoverageCounts): string {
  const reasons = countedPhrases([
    [covered.signature, 'by signature'],
    [covered.allowlist, 'by allowlist rule'],
    [covered.override, 'by maintainer override'],
  ]);
  const total = covered.signature + covered.allowlist + covered.override;
  const covering = `${renderCount(total)} ${total === 1 ? 'contributor' : 'contributors'} covered`;
  return reasons.length === 0 ? `${covering}.` : `${covering}: ${reasons.join(', ')}.`;
}

/** A finished check: its conclusion, title and summary, and the text when there is one. */
function completed(conclusion: CheckConclusion, title: string, summary: string, text = ''): CheckOutput {
  return { status: 'completed', conclusion, title, summary, ...(text === '' ? {} : { text }) };
}

/** The output of a failed check: the sections as the summary, or one sentence when the sections are empty. */
function failureOutput(view: Extract<CheckView, { kind: 'failure' }>): CheckOutput {
  const commit = shortSha(view.headSha);
  const sections = renderParts(view.summary);
  const summary =
    sections === ''
      ? `The CLA check did not pass for commit ${commit}. Comment \`/recheck\` to run it again.`
      : sections;
  return completed('failure', failureTitle(view.unsigned, view.unlinked), summary, renderParts(view.text ?? []));
}

/**
 * The Check Run output of a view. Names no one except through the sections of a failure, which are encoded by E09-S01
 * before they get here. @throws InvalidShaError for a head SHA that is not a full lower-case SHA, InvalidIdError for a count
 * that is not a non-negative safe integer, OutputTooLongError when the fixed text of a failure does not fit the limit.
 */
export function renderCheckOutput(view: CheckView): CheckOutput {
  switch (view.kind) {
    case 'success':
      return completed(
        'success',
        TITLES.success,
        `${coverageSentence(view.covered)}\n\nChecked commit ${shortSha(view.headSha)}.`,
      );
    case 'failure':
      return failureOutput(view);
    case 'in_progress':
      return {
        status: 'in_progress',
        title: TITLES.in_progress,
        summary: `Evaluating commit ${shortSha(view.headSha)}. This updates automatically. Comment \`/recheck\` to run it again.`,
      };
    case 'cancelled':
      return completed('cancelled', TITLES.cancelled, CANCELLED_SUMMARY);
    case 'enforcement_disabled':
      return completed('neutral', TITLES.enforcement_disabled, ENFORCEMENT_DISABLED_SUMMARY);
  }
}
