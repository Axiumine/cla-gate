// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { CheckView } from './check-view.ts';
import type { FailureRequest } from './failure-input.ts';
import { corporateParts, notBlockingParts, noticeParts, peopleSections } from './failure-sections.ts';
import { CLOSING_LINE, HOW_TO_FIX } from './failure-text.ts';
import type { OutputPart } from './output-parts.ts';

// E09-S03: the failure report. It turns the evaluation of a pull request that did not pass into the sections a contributor
// reads, in this order and each only when it has something to say: the sign link, `Not signed (N)`, `Email not linked to a
// GitHub account (M)`, the one line about commits a maintainer override covers, the one about people a corporate CLA covers
// (E21-S05), `How to fix` (only with an unlinked commit), the closing line, `Not blocking`. The sections are `OutputPart`s of
// already encoded text, so `renderCheckOutput` (the Check Run) and the pull request comment of E09-S07 print the same words.
// Every name goes through `renderName`, a SHA through `shortSha`, a number through `renderId` (E09-S01); no email address is read.

export type { FailureRequest } from './failure-input.ts';

/** The failure view of a Check Run. */
type FailureView = Extract<CheckView, { readonly kind: 'failure' }>;

/** The report: the Check Run view, and the address of the sign page when the view links to it. */
export interface FailureReport {
  readonly view: FailureView;
  /** The sign link as a plain address, for the `details_url` of the Check Run; `null` when the report has no sign link. */
  readonly signUrl: string | null;
}

/**
 * The failure report of an evaluation that did not pass.
 * @throws InvalidSignLinkError when a sign link is due and the repository id, the pull request number or the base URL cannot
 * make one; InvalidShaError for a commit SHA that is not a full SHA; InvalidIdError for a number that is not a safe integer.
 */
export function failureReport(request: FailureRequest): FailureReport {
  const people = peopleSections(request);
  const summary: OutputPart[] = [
    ...people.parts,
    ...corporateParts(request.evaluation),
    ...noticeParts(request.evaluation),
    ...(people.unlinked === 0 ? [] : [HOW_TO_FIX]),
    CLOSING_LINE,
    ...notBlockingParts(request),
  ];
  const view: FailureView = {
    kind: 'failure',
    headSha: request.headSha,
    unsigned: people.unsigned,
    unlinked: people.unlinked,
    summary,
  };
  return { view, signUrl: people.signUrl };
}
