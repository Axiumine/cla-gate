// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type PrEvaluationDetails, STORED_LIMITS } from '../../../shared/pr-evaluation-details.ts';
import { classifyAccount } from './classify.ts';
import type { CoveredActor } from './coverage-types.ts';
import type { Evaluation } from './evaluation-types.ts';
import type { CoveringBasis } from './types.ts';
import { storedUnlinked } from './unlinked.ts';

// E08-S08: the evaluation as `pr_evaluations.details` (the schema of E08-S01). Every field is copied by name, so nothing
// the in-memory result carries for the renderer (the display-only raw identity of an unlinked commit, an app slug) can
// reach the stored value, and a field added to the result later is not stored unless it is added here on purpose.

type StoredActor = PrEvaluationDetails['actors'][number];

/** The basis as stored: the same fields, copied one by one. */
function storedBasis(basis: CoveringBasis | null): StoredActor['basis'] {
  if (basis === null) {
    return null;
  }
  switch (basis.kind) {
    case 'signature':
      return { kind: 'signature', signatureId: basis.signatureId, versionId: basis.versionId, major: basis.major };
    case 'allowlist':
      return { kind: 'allowlist', entryId: basis.entryId, entryKind: basis.entryKind, scope: basis.scope };
    case 'corporate_approval':
      return { kind: 'corporate_approval', agreementId: basis.agreementId, approvalId: basis.approvalId };
  }
}

/**
 * The actor as stored. A bot carries `bot: true` (E15-S07) and a person nothing, so every value stored for people is as it was; the
 * mark comes from the account type GitHub reported and from nothing else, the rule of `classifyAccount`.
 */
function storedActor(actor: CoveredActor): StoredActor {
  return {
    githubId: actor.account.id,
    roles: [...actor.roles],
    covered: actor.covered,
    basis: storedBasis(actor.basis),
    ...(classifyAccount(actor.account) === 'bot' ? { bot: true } : {}),
  };
}

interface Bounded<T> {
  readonly kept: readonly T[];
  readonly omitted: number;
}

/**
 * At most `limit` of `items`, in their own order. When some must go, the urgent ones are kept first (in order), then the
 * rest: what explains a failure outlives what only records a success. The count of the ones left out is returned, so
 * the stored value says what it does not hold.
 */
function bounded<T>(items: readonly T[], limit: number, isUrgent: (item: T) => boolean = () => true): Bounded<T> {
  const ranked = [...items.filter(isUrgent), ...items.filter((item) => !isUrgent(item))];
  const keep = new Set(ranked.slice(0, limit));
  return { kept: items.filter((item) => keep.has(item)), omitted: Math.max(0, items.length - limit) };
}

/** The `omitted` field, present only when something was left out (a value that omits nothing has no such field). */
function omittedField(omitted: NonNullable<PrEvaluationDetails['omitted']>): Pick<PrEvaluationDetails, 'omitted'> {
  return omitted.actors + omitted.unlinked + omitted.advisories === 0 ? {} : { omitted };
}

/**
 * The stored details of an evaluation: numeric ids and codes only, no name, login, email or app slug, and no commit
 * message. The fixes are not stored; they are derived from the facts and recomputed when the page is rendered. Each list
 * is bounded by `STORED_LIMITS`, so one row stays under 256 KiB however hostile the pull request: the uncovered actors
 * and the unlinked identities without an override are kept first, and `omitted` counts what was left out. The verdict
 * (`outcome`, `failureCodes`) is computed before and never changes by this.
 */
export function toStoredDetails(evaluation: Evaluation): PrEvaluationDetails {
  const actors = bounded(evaluation.actors.map(storedActor), STORED_LIMITS.actors, (actor) => !actor.covered);
  const unlinked = bounded(
    storedUnlinked(evaluation.findings),
    STORED_LIMITS.unlinked,
    (finding) => finding.overrideId === null,
  );
  const advisories = bounded(
    evaluation.advisories.map(({ code, sha }) => ({ code, sha })),
    STORED_LIMITS.advisories,
  );
  return {
    version: 1,
    outcome: evaluation.outcome,
    failureCodes: [...evaluation.failureCodes],
    documentId: evaluation.policy?.documentId ?? null,
    activeMajor: evaluation.policy?.activeMajor ?? null,
    commitCount: evaluation.commitCount,
    mergeCommitsSkipped: evaluation.mergeCommitsSkipped,
    listing: evaluation.listing,
    actors: [...actors.kept],
    unlinked: [...unlinked.kept],
    advisories: [...advisories.kept],
    ...omittedField({ actors: actors.omitted, unlinked: unlinked.omitted, advisories: advisories.omitted }),
  };
}
