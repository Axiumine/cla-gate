// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { PrEvaluationDetails } from '../../../shared/pr-evaluation-details.ts';

// The `details` of a pull request that failed because some people had not signed, in the shape the engine of E08 stores
// (`pr_evaluations.details`, valid for its schema), for the tests of the evaluations a signature asks for (E13-S07).

/** What a test chooses of a stored failure: who is listed as uncovered, and who as covered. */
interface FailureSpec {
  /** The numeric GitHub ids that the failure lists as not covered: the ones a signature can turn around. */
  readonly uncovered: readonly number[];
  /** The ids that are covered by a signature of the active version. */
  readonly covered?: readonly number[];
  readonly documentId?: number;
}

/** The details of an evaluation that failed with `unsigned_contributor`, valid for the schema of `pr_evaluations.details`. */
export function failureDetails(spec: FailureSpec): PrEvaluationDetails {
  const covered = (spec.covered ?? []).map((githubId, index) => ({
    githubId,
    roles: ['committer' as const],
    covered: true,
    basis: { kind: 'signature' as const, signatureId: index + 1, versionId: 1, major: 1 },
  }));
  const uncovered = spec.uncovered.map((githubId) => ({
    githubId,
    roles: ['author' as const],
    covered: false,
    basis: null,
  }));
  return {
    version: 1,
    outcome: 'failure',
    failureCodes: ['unsigned_contributor'],
    documentId: spec.documentId ?? 1,
    activeMajor: 1,
    commitCount: 1,
    mergeCommitsSkipped: 0,
    listing: 'complete',
    actors: [...uncovered, ...covered],
    unlinked: [],
    advisories: [],
  };
}

/** The details of an evaluation that passed: the people it lists are all covered. */
export function successDetails(covered: readonly number[]): PrEvaluationDetails {
  return {
    ...failureDetails({ uncovered: [], covered }),
    outcome: 'success',
    failureCodes: [],
  };
}
