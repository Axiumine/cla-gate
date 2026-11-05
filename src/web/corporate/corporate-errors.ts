// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { ApiError } from '../api/index.ts';

// The words for what can go wrong when a company signs (E21-S02) and when an employee claims coverage (E21-S04). The codes are those of the corporate rules and of the name and the
// address of the signer; the web's shared catalog of error codes does not list them, so this screen reads them itself and every
// other failure goes through the generic states.

/** The codes of the signing request that have a message of their own, each the key `corporate.error.<code>`. */
const CORPORATE_CODES = [
  'agreement_exists',
  'agreement_revoked',
  'corporate_cla_not_configured',
  'email_not_verified',
  'hash_mismatch',
  'installation_suspended',
  'invalid_name',
  'no_matching_approval',
  'no_verified_email',
  'upstream_unavailable',
  'validation_failed',
  'version_outdated',
] as const;

type CorporateCode = (typeof CORPORATE_CODES)[number];

/** The codes that a newer text answers: the person loads it and signs that. */
const RELOADABLE: readonly string[] = ['hash_mismatch', 'version_outdated'];

const isCorporateCode = (code: string): code is CorporateCode => CORPORATE_CODES.some((known) => known === code);

/** The catalog key of the message for `error`, or `null` when it is not one of the corporate codes (the generic states say it). */
export function corporateErrorKey(error: unknown): `corporate.error.${CorporateCode}` | null {
  return error instanceof ApiError && isCorporateCode(error.code) ? `corporate.error.${error.code}` : null;
}

/** Whether the failure is a text that has moved on, which loading the current text repairs. */
export function isReloadable(error: unknown): boolean {
  return error instanceof ApiError && RELOADABLE.includes(error.code);
}
