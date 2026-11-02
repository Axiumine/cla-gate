// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { PrEvaluationDetails } from '../../../shared/pr-evaluation-details.ts';
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
  }
}

function storedActor(actor: CoveredActor): StoredActor {
  return {
    githubId: actor.account.id,
    roles: [...actor.roles],
    covered: actor.covered,
    basis: storedBasis(actor.basis),
  };
}

/**
 * The stored details of an evaluation: numeric ids and codes only, no name, login, email or app slug, and no commit
 * message. The fixes are not stored; they are derived from the facts and recomputed when the page is rendered.
 */
export function toStoredDetails(evaluation: Evaluation): PrEvaluationDetails {
  return {
    version: 1,
    outcome: evaluation.outcome,
    failureCodes: [...evaluation.failureCodes],
    documentId: evaluation.policy?.documentId ?? null,
    activeMajor: evaluation.policy?.activeMajor ?? null,
    commitCount: evaluation.commitCount,
    mergeCommitsSkipped: evaluation.mergeCommitsSkipped,
    listing: evaluation.listing,
    actors: evaluation.actors.map(storedActor),
    unlinked: storedUnlinked(evaluation.findings),
    advisories: evaluation.advisories.map(({ code, sha }) => ({ code, sha })),
  };
}
