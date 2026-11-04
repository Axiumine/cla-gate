// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { CURRENT_CONSENT_ID } from '../../shared/consent.ts';
import type { CurrentVersion, SignRefusalRule } from '../../shared/sign.ts';

// Whether a sign request is about what is in force today (E13-S04), pure. The page sends the version it showed (its id and the
// SHA-256 of its text) and the consent sentence by its id; this function holds them against the version the document points at
// now. The checks run in a fixed order and stop at the first that fails, so the answer never depends on which of two things
// that are both wrong the code looked at first. It reads no row and no clock.

/** The version in force for the document and what kind of document it is: the facts a request is judged against. */
export interface VersionInForce extends CurrentVersion {
  /** The kind of the document: only an `individual` one is signed through the sign page. */
  readonly documentKind: 'individual' | 'corporate';
}

/** What the request says it was shown: the version, the hash of its text and the consent sentence. */
export interface ShownToSigner {
  readonly versionId: number;
  readonly contentSha256: string;
  readonly consentTextId: string;
}

/** The rule a request broke. A stale version carries the version in force, so the page can load it. */
export type SignRefusal =
  | { readonly rule: 'stale_version'; readonly current: CurrentVersion }
  | { readonly rule: Exclude<SignRefusalRule, 'stale_version'> };

/**
 * The first rule the request breaks, or `null` when it is about the version in force. In order: the version is not the one the
 * document points at (`stale_version`; a version of another document, or of another tenant, is a version that is not it, so the
 * answer confirms nothing about them); the hash is not the hash stored for that version (`hash_mismatch`); the consent sentence is
 * not the one offered today (`stale_consent`); the document is not an individual CLA (`unsupported_document_kind`).
 */
export function judgeSignRequest(shown: ShownToSigner, inForce: VersionInForce): SignRefusal | null {
  if (shown.versionId !== inForce.versionId) {
    return {
      rule: 'stale_version',
      current: {
        versionId: inForce.versionId,
        major: inForce.major,
        minor: inForce.minor,
        contentSha256: inForce.contentSha256,
      },
    };
  }
  if (shown.contentSha256 !== inForce.contentSha256) {
    return { rule: 'hash_mismatch' };
  }
  if (shown.consentTextId !== CURRENT_CONSENT_ID.individual) {
    return { rule: 'stale_consent' };
  }
  return inForce.documentKind === 'individual' ? null : { rule: 'unsupported_document_kind' };
}
