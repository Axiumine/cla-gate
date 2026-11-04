// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { cleanName } from './clean-name.ts';

// The two free inputs of the consent form (E13-S03): the name the signer types and the e-mail address they ask for. One
// schema reads them, so the form in the browser and the server that records the signature agree. The address is only a
// request here: it counts when it is one of the verified addresses of the session (`resolveSignerEmail`, server side), and the
// stored address is the one GitHub reported, not the text that was typed.

/**
 * The most code points a typed name has once cleaned.
 * @internal exported for the tests of the limit
 */
export const SIGNER_NAME_MAX_CODE_POINTS = 200;

/** The longest address the server stores, in characters (the limit of an address in SMTP). A longer request cannot be a verified address. */
export const SIGNER_EMAIL_MAX_LENGTH = 254;

/** The rules the two inputs can break, each with the status the API answers with. The code is the `code` of the error body. */
export const SIGNER_RULE_STATUS = {
  invalid_name: 422,
  email_not_verified: 422,
  no_verified_email: 422,
} as const;

export type SignerRule = keyof typeof SIGNER_RULE_STATUS;

/**
 * A character a person can see in a name. These are not visible: white space and separators (a control cannot be here,
 * `cleanName` refused it), format and default-ignorable characters (zero-width space and joiners, marks of direction, the word
 * joiner, the soft hyphen, variation selectors, tags), combining marks (they need a character under them), the Braille blank
 * and the four Hangul fillers (letters in Unicode, but blank on a screen). A name made only of these reads as empty although
 * it is not.
 */
const HAS_VISIBLE_CHARACTER =
  /[^\p{Cf}\p{Z}\p{M}\p{Default_Ignorable_Code_Point}\u{2800}\u{115F}\u{1160}\u{3164}\u{FFA0}]/u;

/**
 * The typed name: NFC, trimmed, every run of white space one space, then 1 to {@link SIGNER_NAME_MAX_CODE_POINTS} code points
 * (`cleanName`). A name that holds a control character, a line or paragraph separator, a bidirectional override, embedding or
 * isolate, or a lone surrogate is a failure with the issue code `invalid_name` (zod calls every custom issue `custom`, so the
 * code is in `params.code`), and so is a name in which nothing can be seen ({@link HAS_VISIBLE_CHARACTER}): the typed name is the
 * visible evidence of the signature. Nothing else is refused: a formula, markup or a mention is a name, and is kept as typed.
 */
const signerNameSchema = z.string().transform((raw, ctx) => {
  const name = cleanName(raw, SIGNER_NAME_MAX_CODE_POINTS);
  if (name === null || !HAS_VISIBLE_CHARACTER.test(name)) {
    ctx.issues.push({ code: 'custom', message: 'invalid_name', input: raw, params: { code: 'invalid_name' } });
    return z.NEVER;
  }
  return name;
});

/**
 * `{ name, email }` as a signer typed it. The name is cleaned and checked as above. The address is any text: its only proof is
 * membership in the verified list, and format checks would reject nothing that list does not (a longer address than
 * {@link SIGNER_EMAIL_MAX_LENGTH}, for one, fails there as `email_not_verified`).
 */
export const signerInputSchema = z.strictObject({ name: signerNameSchema, email: z.string() });

export type SignerInput = z.input<typeof signerInputSchema>;
