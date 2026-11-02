// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { PrEvaluationDetails } from '../../../shared/pr-evaluation-details.ts';
import type { UnlinkedFinding, UnlinkedRole } from './actor-types.ts';
import { compareShaThenRole } from './order.ts';
import type { FailureCode, FixCode } from './types.ts';

// E08-S05: what to do with an author or committer that GitHub could not link to an account. The engine never guesses an
// account from the commit's name or email (a commit email is text anyone can write), so the only ways out are the
// contributor linking the email to their GitHub account, or a maintainer's audited per-commit override. An override
// waives the unlinked identities of one commit and nothing else: it is not an input to coverage, so it cannot create a
// signature, add an actor or change who is covered.

/** Tell the contributor to add the commit email to their GitHub account, for one role of one commit. No address in it. */
export interface LinkCommitEmailFix {
  readonly code: Extract<FixCode, 'link_commit_email'>;
  readonly sha: string;
  readonly role: UnlinkedRole;
}

/** Tell a maintainer they may override one commit. One per commit, however many of its identities are unlinked. */
export interface MaintainerOverrideFix {
  readonly code: Extract<FixCode, 'maintainer_override'>;
  readonly sha: string;
}

export type UnlinkedFix = LinkCommitEmailFix | MaintainerOverrideFix;

/**
 * An unlinked finding with the override that waives it, if any. `raw` is the display-only identity for the renderer
 * (E09); it stays in memory and `storedUnlinked` leaves it out.
 */
export interface AssessedFinding extends UnlinkedFinding {
  readonly overrideId: number | null;
}

export interface UnlinkedAssessment {
  /** `['unlinked_identity']` when a finding has no override, else empty. */
  readonly failureCodes: readonly FailureCode[];
  /** Every finding, overridden or not, sorted by SHA then role, with lower-case SHAs. */
  readonly findings: readonly AssessedFinding[];
  /** Sorted by code, then SHA, then role. Only findings without an override ask for a fix. */
  readonly fixes: readonly UnlinkedFix[];
}

/**
 * Overrides by lower-case SHA. A SHA is hex, so case is no identity; two keys that differ only in case collapse to the
 * lowest override id, which keeps the answer independent of the order the map was filled in.
 */
function overridesByLowerSha(overrides: ReadonlyMap<string, number>): ReadonlyMap<string, number> {
  const byLowerSha = new Map<string, number>();
  for (const [sha, overrideId] of overrides) {
    const key = sha.toLowerCase();
    const known = byLowerSha.get(key);
    if (known === undefined || overrideId < known) {
      byLowerSha.set(key, overrideId);
    }
  }
  return byLowerSha;
}

/** `link_commit_email` for each finding, then one `maintainer_override` per commit; `unresolved` is already sorted. */
function fixesFor(unresolved: readonly AssessedFinding[]): UnlinkedFix[] {
  const linkFixes = unresolved.map(
    (finding): UnlinkedFix => ({ code: 'link_commit_email', sha: finding.sha, role: finding.role }),
  );
  const overrideShas = new Set(unresolved.map((finding) => finding.sha));
  return [...linkFixes, ...[...overrideShas].map((sha): UnlinkedFix => ({ code: 'maintainer_override', sha }))];
}

/**
 * Matches each unlinked finding of E08-S02 against `overrides` by commit SHA, compared in lower case. A matching finding
 * is overridden by that override id and does not fail the pull request; an override for a SHA with no finding is ignored.
 * One override resolves both findings of a commit whose author and committer are unlinked. A finding without an override
 * adds `unlinked_identity` and the fixes `link_commit_email { sha, role }` and `maintainer_override { sha }`.
 */
export function assessUnlinked(
  findings: readonly UnlinkedFinding[],
  overrides: ReadonlyMap<string, number>,
): UnlinkedAssessment {
  const byLowerSha = overridesByLowerSha(overrides);
  const assessed = findings
    .map((finding): AssessedFinding => {
      const sha = finding.sha.toLowerCase();
      return { ...finding, sha, overrideId: byLowerSha.get(sha) ?? null };
    })
    .sort(compareShaThenRole);
  const unresolved = assessed.filter((finding) => finding.overrideId === null);
  return {
    failureCodes: unresolved.length === 0 ? [] : ['unlinked_identity'],
    findings: assessed,
    fixes: fixesFor(unresolved),
  };
}

/**
 * The findings as `pr_evaluations.details.unlinked`: `{ sha, role, overrideId }` and nothing else, so the audit trail
 * shows which commits passed by override and no name or email is ever written.
 */
export function storedUnlinked(findings: readonly AssessedFinding[]): PrEvaluationDetails['unlinked'] {
  return findings.map(({ sha, role, overrideId }) => ({ sha, role, overrideId }));
}
