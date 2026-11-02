// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { compareText } from './order.ts';
import type { FailureCode, Outcome } from './types.ts';

// E08-S04: how failure codes become a result. The codes of a pull request are a set, listed in one fixed order, and the
// outcome is derived from them alone, so the two can never disagree (the stored-details schema refuses a row that does).

/** The failure codes without repeats, in code-unit order, so the same facts always list them the same way. */
export function sortedUniqueCodes(codes: readonly FailureCode[]): FailureCode[] {
  return [...new Set(codes)].sort(compareText);
}

/** `success` exactly when nothing failed: a result with a failure code cannot pass, and one without cannot fail. */
export function outcomeOf(failureCodes: readonly FailureCode[]): Outcome {
  return failureCodes.length === 0 ? 'success' : 'failure';
}
