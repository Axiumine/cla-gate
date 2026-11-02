// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Policy, SignatureBasis, SignatureFact } from './types.ts';

// E08-S04: which signature, if any, covers an account. Consent is tied to one document and to the major version the
// repository enforces now. Minor versions are not part of the input, so nothing here can depend on one.

/**
 * A fact covers its user when it is for the policy's document, at exactly the active major, and not revoked. Equality,
 * not "at least": a rollback publishes a new version, so a signature of a higher major than the active one is no more
 * valid than one of a lower major. The loader already filters revoked signatures; checking again means a loader bug
 * cannot turn a revocation into coverage.
 */
function covers(fact: SignatureFact, policy: Policy): boolean {
  return fact.documentId === policy.documentId && fact.major === policy.activeMajor && !fact.revoked;
}

/** The covering signature of every user who has one, as a covering basis. Built once per evaluation. */
export type SignatureIndex = ReadonlyMap<number, SignatureBasis>;

/**
 * The signatures that cover each user under `policy`, one pass over the facts however many actors will be looked up
 * afterwards. When several facts cover the same user the one with the lowest signature id is the basis, so the order of
 * `signatures` never changes the answer. The numeric id is the only identity compared: the account's type is the
 * caller's business (a bot cannot consent, see coverage.ts).
 */
export function indexCoveringSignatures(policy: Policy, signatures: readonly SignatureFact[]): SignatureIndex {
  const best = new Map<number, SignatureFact>();
  for (const fact of signatures) {
    const known = best.get(fact.githubId);
    if (covers(fact, policy) && (known === undefined || fact.id < known.id)) {
      best.set(fact.githubId, fact);
    }
  }
  return new Map(
    [...best].map(([githubId, fact]): [number, SignatureBasis] => [
      githubId,
      { kind: 'signature', signatureId: fact.id, versionId: fact.versionId, major: fact.major },
    ]),
  );
}
