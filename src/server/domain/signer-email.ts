// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { SIGNER_EMAIL_MAX_LENGTH, type SignerRule } from '../../shared/signer-input.ts';
import type { VerifiedEmail } from '../../shared/verified-email.ts';

// Which e-mail address a signer asked for, judged against the addresses GitHub verified (E13-S03), pure. Membership in that
// list is the only proof the platform uses: the format of the typed text is never checked, and an address that is not in the
// list is never accepted. What comes back is the address as GitHub reported it, so the casing on the signature is GitHub's.

/** The answer: the address to store, or the rule the request broke. */
export type SignerEmailResolution =
  | { readonly ok: true; readonly email: string }
  | { readonly ok: false; readonly rule: Extract<SignerRule, 'email_not_verified' | 'no_verified_email'> };

/**
 * `text` with the ASCII capitals made small and every other character left as it is. Only ASCII letters fold, on purpose: the
 * Unicode lower case of the Kelvin sign (U+212A) is `k` and that of the long s (U+017F) is `s`, so folding all of Unicode would
 * accept an address that only looks like the verified one. Folding keeps the length, so a match is never longer than the request.
 */
const foldAscii = (text: string): string => text.replaceAll(/[A-Z]/gu, (capital) => capital.toLowerCase());

/**
 * The verified address the viewer asked for. `requested` is trimmed (white space of any kind at both ends) and compared with
 * each address of `verified` without regard to ASCII case; an address with the very same casing wins, and among several that
 * only differ in case the first of the list does. The answer carries the address exactly as it is in `verified`, never the
 * typed text. Failures: `no_verified_email` for an empty list (whatever was asked), `email_not_verified` for a request that
 * matches nothing, including an empty one and one longer than {@link SIGNER_EMAIL_MAX_LENGTH} characters, which no stored address can be.
 */
export function resolveSignerEmail(
  verified: readonly Pick<VerifiedEmail, 'email'>[],
  requested: string,
): SignerEmailResolution {
  if (verified.length === 0) {
    return { ok: false, rule: 'no_verified_email' };
  }
  const wanted = requested.trim();
  if (wanted.length === 0 || wanted.length > SIGNER_EMAIL_MAX_LENGTH) {
    return { ok: false, rule: 'email_not_verified' };
  }
  const folded = foldAscii(wanted);
  const match =
    verified.find(({ email }) => email === wanted) ?? verified.find(({ email }) => foldAscii(email) === folded);
  return match === undefined ? { ok: false, rule: 'email_not_verified' } : { ok: true, email: match.email };
}
