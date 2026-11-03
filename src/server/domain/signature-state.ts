// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// Whether a signature still covers its signer (E13-S06, E15-S02, E16-S03): one pure function, so the own-signatures list, the
// maintainers' search and the export say the same thing.

/** @internal Exported for the tests that hold the SQL conditions of the export to this function (Knip ignores `@internal` exports in production mode). */
export const SIGNATURE_STATES = ['active', 'outdated', 'revoked'] as const;

export type SignatureState = (typeof SIGNATURE_STATES)[number];

/** The two facts of a signature that decide its state. */
interface StateFacts {
  /** Whether it was revoked. */
  readonly revoked: boolean;
  /** The major version of the CLA the person signed. */
  readonly major: number;
}

/**
 * `revoked` when the signature was revoked; `outdated` when it was not and the major version signed is lower than the
 * document's active major; `active` otherwise, which includes a document that has no active version yet (`activeMajor`
 * is `null`).
 */
export function signatureState(signature: StateFacts, activeMajor: number | null): SignatureState {
  if (signature.revoked) {
    return 'revoked';
  }
  return activeMajor !== null && signature.major < activeMajor ? 'outdated' : 'active';
}
