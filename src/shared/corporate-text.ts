// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { cleanName } from './clean-name.ts';
import { REVOKE_REASON_MAX_CODE_POINTS } from './corporate-approvals.ts';
import { HAS_VISIBLE_CHARACTER } from './signer-input.ts';

// The two free texts of a corporate agreement (E21-S02): the company the signatory signs for and the title they sign with. One
// cleaning reads them, the one of every name a person types (`cleanName`): NFC, the ends trimmed, every run of white space one
// space, and no control character, line or paragraph separator, bidirectional override, embedding or isolate, or lone surrogate.
// Nothing else is refused: markup, a formula or a mention is a company name and is kept as typed, and every output escapes it
// for its own context.

/** The most code points a company name has once cleaned: the limit of `corporate_agreement_pii.company_name`. */
export const COMPANY_NAME_MAX_CODE_POINTS = 200;

/** The most code points a signatory title has once cleaned: the limit of `corporate_agreement_pii.signatory_title`. */
export const SIGNATORY_TITLE_MAX_CODE_POINTS = 100;

/** `raw` cleaned, or `null` when it cannot be the text: empty once cleaned, over `maxCodePoints`, forbidden characters, or nothing a person can see in it. */
function cleanVisible(raw: string, maxCodePoints: number): string | null {
  // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- one negated character class with no quantifier (linear time), run on a text of at most 200 code points
  const text = cleanName(raw, maxCodePoints);
  return text !== null && HAS_VISIBLE_CHARACTER.test(text) ? text : null;
}

/** The company name to store for `raw` (1 to {@link COMPANY_NAME_MAX_CODE_POINTS} code points), or `null` when it cannot be one. */
export function cleanCompanyName(raw: string): string | null {
  return cleanVisible(raw, COMPANY_NAME_MAX_CODE_POINTS);
}

/** The signatory title to store for `raw` (1 to {@link SIGNATORY_TITLE_MAX_CODE_POINTS} code points), or `null` when it cannot be one. */
export function cleanSignatoryTitle(raw: string): string | null {
  return cleanVisible(raw, SIGNATORY_TITLE_MAX_CODE_POINTS);
}

/**
 * The reason to store for the revocation of an approval (E21-S03), or `null` when `raw` cannot be one: the same cleaning, 1 to
 * {@link REVOKE_REASON_MAX_CODE_POINTS} code points, and no `@`. The reason cannot be edited or erased once stored, so it must hold no
 * personal data; the one kind of personal data a line of text is likely to carry is an address, and that is what the `@` refuses.
 */
export function cleanRevokeReason(raw: string): string | null {
  const text = cleanVisible(raw, REVOKE_REASON_MAX_CODE_POINTS);
  return text !== null && !text.includes('@') ? text : null;
}
