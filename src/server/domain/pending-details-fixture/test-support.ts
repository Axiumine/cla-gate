// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FAILURE_CODES } from '../../../shared/pr-evaluation-codes.ts';
import type { PrEvaluationDetails } from '../../../shared/pr-evaluation-details.ts';

// The stored details of failed evaluations for the tests of the pending pull requests (E15-S07): valid for the schema of
// `pr_evaluations.details` (E08-S01), written from a short description of who is listed and what failed.

/** One account of the pull request: covered by a signature or not, and a bot or not. */
interface ActorSpec {
  readonly githubId: number;
  readonly covered?: boolean;
  readonly bot?: boolean;
}

/** One unlinked identity of a commit, waived by an override or not. */
interface UnlinkedSpec {
  readonly sha: string;
  readonly role?: 'author' | 'committer';
  readonly overrideId?: number | null;
}

/** What a test says of a failed evaluation. */
export interface DetailsSpec {
  readonly codes: readonly (typeof FAILURE_CODES)[number][];
  readonly actors?: readonly ActorSpec[];
  readonly unlinked?: readonly UnlinkedSpec[];
}

/** A commit SHA made of the hexadecimal digits of `n`, 40 characters. */
export const shaOf = (n: number): string => n.toString(16).padStart(40, '0');

/** The details of an evaluation described by `spec`: a failure whose actors are covered by a signature of major 1 or not. */
export function detailsOf(spec: DetailsSpec): PrEvaluationDetails {
  const noPolicy = spec.codes.includes('no_active_cla');
  return {
    version: 1,
    outcome: spec.codes.length === 0 ? 'success' : 'failure',
    failureCodes: [...spec.codes],
    documentId: noPolicy ? null : 1,
    activeMajor: noPolicy ? null : 1,
    commitCount: 1,
    mergeCommitsSkipped: 0,
    listing: 'complete',
    actors: (spec.actors ?? []).map((actor) => ({
      githubId: actor.githubId,
      roles: ['author'],
      covered: actor.covered === true,
      basis: actor.covered === true ? { kind: 'signature', signatureId: 1, versionId: 1, major: 1 } : null,
      ...(actor.bot === true ? { bot: true } : {}),
    })),
    unlinked: (spec.unlinked ?? []).map((finding) => ({
      sha: finding.sha,
      role: finding.role ?? 'author',
      overrideId: finding.overrideId ?? null,
    })),
    advisories: [],
  };
}
