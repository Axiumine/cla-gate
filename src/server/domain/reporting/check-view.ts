// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { OutputPart } from './output-parts.ts';

// E09-S02: the data of a Check Run report. A view is what the evaluation (or its lifecycle) says; `renderCheckOutput`
// (check-output.ts) turns it into the `status`, `conclusion` and `output` of the GitHub call.

/** What GitHub calls the state of a Check Run. `queued` is never emitted. */
type CheckStatus = 'in_progress' | 'completed';

/**
 * The conclusions this App emits, and no others: `skipped`, `timed_out`, `action_required` and `stale` cannot be written. GitHub
 * counts `success` and `neutral` as passing for a required check; `failure` and `cancelled` do not pass.
 */
export type CheckConclusion = 'success' | 'failure' | 'neutral' | 'cancelled';

/** How many contributors each covering basis accounts for: `override` counts commits whose unlinked identity a maintainer waived. */
export interface CoverageCounts {
  readonly signature: number;
  readonly allowlist: number;
  readonly override: number;
}

/**
 * The six things a Check Run can say. The first four names are the values of `pr_evaluations.result` (`cancelled` is the
 * lifecycle value of E07-S06); `enforcement_disabled` is the fifth, for a repository whose maintainers turned the check off, and
 * `evaluation_failed` the sixth (E09-S06), for an evaluation that could not be completed: a failure that names no one. A
 * failure brings its counts, for the title, and the parts of the summary (and, if the sections want one, the text).
 */
export type CheckView =
  | { readonly kind: 'success'; readonly headSha: string; readonly covered: CoverageCounts }
  | {
      readonly kind: 'failure';
      readonly headSha: string;
      readonly unsigned: number;
      readonly unlinked: number;
      readonly summary: readonly OutputPart[];
      readonly text?: readonly OutputPart[];
    }
  | { readonly kind: 'in_progress'; readonly headSha: string }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'enforcement_disabled' }
  | { readonly kind: 'evaluation_failed' };

/** The `status`, `conclusion` and `output` of a Check Run. A Check Run that is `in_progress` has no conclusion. */
export interface CheckOutput {
  readonly status: CheckStatus;
  readonly conclusion?: CheckConclusion;
  readonly title: string;
  readonly summary: string;
  readonly text?: string;
}
