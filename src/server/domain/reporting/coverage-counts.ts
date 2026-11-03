// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { CoverageCounts } from './check-view.ts';

// E09-S02: the counts the success summary states, taken from an E08 evaluation. Numbers only: no login, name or email is read.
// The domain layer imports only its own folder, so the evaluation is described by the two fields this reads; the `Evaluation`
// of the engine has them (domain/reporting-evaluation.test.ts hands it real verdicts, so a change in its shape fails there).

/** The part of a covered actor this reads: the kind of the basis that covers it, `null` when nothing does. */
interface ActorBasis {
  readonly basis: { readonly kind: string } | null;
}

/** The part of an unlinked finding this reads: its commit and the override that waives it, `null` when none does. */
interface FindingOverride {
  readonly sha: string;
  readonly overrideId: number | null;
}

/** What {@link coverageCounts} reads of an `Evaluation`. */
export interface CountedEvaluation {
  readonly actors: readonly ActorBasis[];
  readonly findings: readonly FindingOverride[];
}

/** The commits that have at least one unlinked identity waived by an override. */
function overriddenCommits(findings: readonly FindingOverride[]): ReadonlySet<string> {
  return new Set(findings.filter(({ overrideId }) => overrideId !== null).map(({ sha }) => sha));
}

/**
 * How many contributors each covering basis accounts for. An actor is counted once, under the basis that covers it (a
 * signature or an allowlist rule). A maintainer override waives the unlinked identity of a commit, and such an identity has
 * no account to count, so `override` counts the commits that have at least one waived identity, each commit once however
 * many of its identities are waived.
 */
export function coverageCounts(evaluation: CountedEvaluation): CoverageCounts {
  const coveredBy = (kind: string): number => evaluation.actors.filter((actor) => actor.basis?.kind === kind).length;
  return {
    signature: coveredBy('signature'),
    allowlist: coveredBy('allowlist'),
    override: overriddenCommits(evaluation.findings).size,
  };
}
