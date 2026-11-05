// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { RepositorySweep } from './sweep-repository.ts';

// What the sweep of an installation adds up (E07-S08): one {@link Settled} per repository, and the totals that go to the log.

/** What one repository came to, for the totals of the job. */
export type Settled =
  | { readonly kind: 'swept'; readonly sweep: RepositorySweep }
  | { readonly kind: 'unreachable' }
  | { readonly kind: 'failed' };

/** The totals of the job: counts only. */
export interface Totals {
  repositories: number;
  listed: number;
  truncated: number;
  queued: number;
  alreadyQueued: number;
  deduplicated: number;
  closed: number;
  superseded: number;
  markedClosed: number;
  markedOpen: number;
  unreachable: number;
  failed: number;
}

export const emptyTotals = (): Totals => ({
  repositories: 0,
  listed: 0,
  truncated: 0,
  queued: 0,
  alreadyQueued: 0,
  deduplicated: 0,
  closed: 0,
  superseded: 0,
  markedClosed: 0,
  markedOpen: 0,
  unreachable: 0,
  failed: 0,
});

export function addSettled(totals: Totals, settled: Settled): void {
  totals.repositories += 1;
  if (settled.kind === 'failed') {
    totals.failed += 1;
    return;
  }
  if (settled.kind === 'unreachable') {
    totals.unreachable += 1;
    return;
  }
  const { sweep } = settled;
  totals.listed += sweep.listed;
  totals.truncated += sweep.truncated ? 1 : 0;
  totals.queued += sweep.queued;
  totals.alreadyQueued += sweep.alreadyQueued;
  totals.deduplicated += sweep.deduplicated;
  totals.closed += sweep.closed;
  totals.superseded += sweep.superseded;
  totals.markedClosed += sweep.markedClosed;
  totals.markedOpen += sweep.markedOpen;
}
