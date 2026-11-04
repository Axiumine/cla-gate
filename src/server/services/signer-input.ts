// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type SignerInput, signerInputSchema } from '../../shared/signer-input.ts';
import type { VerifiedEmail } from '../../shared/verified-email.ts';
import { resolveSignerEmail } from '../domain/signer-email.ts';
import { SignRuleError } from './sign-rule-error.ts';

// What a signer typed, checked for the signing request (E13-S03; the request itself is E13-S04): the name is cleaned by the
// schema the form shares, the address must be one of the verified addresses of the session.

/** The name and the address to store with a signature: the cleaned name, and the address exactly as GitHub reported it. */
export interface SignerIdentity {
  readonly name: string;
  readonly email: string;
}

/**
 * The identity to record for what `input` holds, against the addresses `verified` that the session captured at login. The
 * name is checked first, then the address.
 * @throws SignRuleError `invalid_name` (the name cannot be one), `no_verified_email` (the list is empty) and
 * `email_not_verified` (the address is not in the list). The error never holds the typed values.
 */
export function checkSignerInput(input: SignerInput, verified: readonly VerifiedEmail[]): SignerIdentity {
  const parsed = signerInputSchema.safeParse(input);
  if (!parsed.success) {
    // The address is any text, so the name is the only input that can fail the schema.
    throw new SignRuleError('invalid_name');
  }
  const resolved = resolveSignerEmail(verified, parsed.data.email);
  if (!resolved.ok) {
    throw new SignRuleError(resolved.rule);
  }
  return { name: parsed.data.name, email: resolved.email };
}
