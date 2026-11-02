// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Policy, SignatureBasis, SignatureFact } from './types.ts';

// E08-S04: which signature, if any, covers an account. Consent is tied to one document and to the major version the
// repository enforces now. Minor versions are not part of the input, so nothing here can depend on one.

/**
 * A fact covers `githubId` when it is that user's, for the policy's document, at exactly the active major, and not
 * revoked. Equality, not "at least": a rollback publishes a new version, so a signature of a higher major than the active
 * one is no more valid than one of a lower major. The loader already filters revoked signatures; checking again means a
 * loader bug cannot turn a revocation into coverage.
 */
function covers(fact: SignatureFact, githubId: number, policy: Policy): boolean {
  return (
    fact.githubId === githubId &&
    fact.documentId === policy.documentId &&
    fact.major === policy.activeMajor &&
    !fact.revoked
  );
}

/**
 * The signature that covers `githubId` under `policy`, as a covering basis, or `null`. When several facts match the one
 * with the lowest signature id is the basis, so the order of `signatures` never changes the answer. The numeric id is the
 * only identity compared: the account's type is the caller's business (a bot cannot consent, see coverage.ts).
 */
export function findCoveringSignature(
  githubId: number,
  policy: Policy,
  signatures: readonly SignatureFact[],
): SignatureBasis | null {
  let best: SignatureFact | null = null;
  for (const fact of signatures) {
    if (covers(fact, githubId, policy) && (best === null || fact.id < best.id)) {
      best = fact;
    }
  }
  return best === null
    ? null
    : { kind: 'signature', signatureId: best.id, versionId: best.versionId, major: best.major };
}
