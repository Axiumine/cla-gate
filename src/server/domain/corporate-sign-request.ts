// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { cleanCompanyName, cleanSignatoryTitle } from '../../shared/corporate-text.ts';
import type { CurrentVersion } from '../../shared/sign.ts';

// Whether a corporate signing request is about what is in force today and says what a signatory must say (E21-S02), pure. The page
// sends the version it showed (its id and the SHA-256 of its text); the first function holds them against the version the
// repository's corporate document points at now, in the order of the individual flow (`judgeSignRequest`, E13-S04), and the second
// reads the texts the signatory typed. Neither reads a row or the clock.

/** What the request says it was shown: the version and the hash of its text. */
export interface ShownCorporateVersion {
  readonly versionId: number;
  readonly contentSha256: string;
}

/** The rule a request broke. A stale version carries the version in force, so the page can load it. */
export type CorporateRefusal =
  | { readonly rule: 'version_outdated'; readonly current: CurrentVersion }
  | { readonly rule: 'hash_mismatch' };

/**
 * The first rule the request breaks, or `null` when it is about the version in force. In order: the version is not the one the
 * corporate document points at (`version_outdated`; a version of another document or another tenant is a version that is not it, so
 * the answer confirms nothing about them), then the hash is not the hash stored for that version (`hash_mismatch`).
 */
export function judgeCorporateRequest(shown: ShownCorporateVersion, inForce: CurrentVersion): CorporateRefusal | null {
  if (shown.versionId !== inForce.versionId) {
    return { rule: 'version_outdated', current: { ...inForce } };
  }
  return shown.contentSha256 === inForce.contentSha256 ? null : { rule: 'hash_mismatch' };
}

/** The texts a signatory typed, before they are cleaned. */
export interface TypedAgreementTexts {
  readonly companyName: string;
  readonly signatoryTitle: string;
  readonly authorityConfirmed: boolean;
}

/** The field a signatory got wrong, named as the request names it. */
type AgreementField = 'authorityConfirmed' | 'companyName' | 'signatoryTitle';

/** The cleaned texts to store, or the first field that cannot be accepted. */
export type AgreementTexts =
  | { readonly ok: true; readonly companyName: string; readonly signatoryTitle: string }
  | { readonly ok: false; readonly field: AgreementField };

/**
 * The cleaned company name and title, or the first field that fails, in the order of the form: the confirmation of the authority
 * (it must be `true`), the company name (1 to 200 code points) and the title (1 to 100), each after Unicode NFC and trimming, with
 * control and bidirectional-override characters refused (`cleanName`).
 */
export function readAgreementTexts(typed: TypedAgreementTexts): AgreementTexts {
  if (!typed.authorityConfirmed) {
    return { ok: false, field: 'authorityConfirmed' };
  }
  const companyName = cleanCompanyName(typed.companyName);
  if (companyName === null) {
    return { ok: false, field: 'companyName' };
  }
  const signatoryTitle = cleanSignatoryTitle(typed.signatoryTitle);
  return signatoryTitle === null ? { ok: false, field: 'signatoryTitle' } : { ok: true, companyName, signatoryTitle };
}
