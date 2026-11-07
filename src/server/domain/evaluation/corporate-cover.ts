// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { CorporateCover } from './types.ts';

// E21-S05: which approvals of a corporate agreement cover a person. The adapter reads, in one statement, the approvals of kind `user` in
// force (not revoked, not expired, the signature of the agreement not revoked) for the people of one pull request, each with the major of
// its agreement and the active major of the repository's corporate document; this module decides, from those plain facts, who is covered and
// who only holds an approval under an outdated agreement. Pure: no clock, no text, no name. A person is a numeric id and nothing else.

/** One approval in force, as the adapter read it: by ids and majors only. */
export interface CorporateApprovalFact {
  readonly approvalId: number;
  readonly agreementId: number;
  readonly githubId: number;
  /** The major the agreement was signed under. */
  readonly agreementMajor: number;
  /** The major of the active version of the corporate document now. */
  readonly activeMajor: number;
}

/** What the facts say: who is covered, by which approval, and who holds an approval that an outdated agreement makes useless. */
export interface CorporateFacts {
  readonly covered: ReadonlyMap<number, CorporateCover>;
  readonly outdated: ReadonlySet<number>;
}

/**
 * The people the approvals cover, and the people they do not because the agreement is outdated. An approval covers its person only when its
 * agreement's major equals the active major: equality, not "at least", as for a signature (E08-S04), since a rollback publishes a new version
 * and a higher major is no more valid than a lower one. When several approvals cover one person, the lowest approval id is the basis, so the
 * order of the facts never changes the answer. A person is outdated only when an approval of an earlier major is all they hold: someone who is
 * covered by one agreement and outdated under another is covered. A higher major than the active one is neither (nobody can mend it by signing).
 */
export function indexCorporateCover(facts: readonly CorporateApprovalFact[]): CorporateFacts {
  const covered = new Map<number, CorporateCover>();
  const behind = new Set<number>();
  for (const fact of facts) {
    // 0: the agreement is of the active major; 1: of an earlier one; -1: of a later one.
    const gap = Math.sign(fact.activeMajor - fact.agreementMajor);
    if (gap === 0) {
      const known = covered.get(fact.githubId);
      if (known === undefined || fact.approvalId < known.approvalId) {
        covered.set(fact.githubId, { agreementId: fact.agreementId, approvalId: fact.approvalId });
      }
    } else if (gap === 1) {
      behind.add(fact.githubId);
    }
  }
  return { covered, outdated: new Set([...behind].filter((githubId) => !covered.has(githubId))) };
}
