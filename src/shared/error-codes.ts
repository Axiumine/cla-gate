// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { SETUP_ERROR_CODES } from './setup.ts';

// The machine codes of the error body (E17-S07): every code a screen of the web app can be handed, in one place, so the
// message catalog can be checked against the list and a code added here without a message fails a test. The envelope itself
// is `errorResponseSchema` (errors.ts); a code is a stable, lower-case snake_case word, and the server's wording is never shown.

/**
 * The default code of the envelope: a status without a domain code of its own is named after its standard text
 * (`errorBody` in the HTTP adapter derives it; a server test pins each entry to that function). The statuses listed are the
 * ones the API can answer with.
 * @internal Exported for the unit tests and the catalog test (Knip ignores `@internal` exports in production mode).
 */
export const STATUS_ERROR_CODES = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  408: 'request_timeout',
  409: 'conflict',
  413: 'payload_too_large',
  414: 'uri_too_long',
  415: 'unsupported_media_type',
  422: 'unprocessable_entity',
  429: 'too_many_requests',
  431: 'request_header_fields_too_large',
  500: 'internal_server_error',
  503: 'service_unavailable',
} as const;

/**
 * The codes that routes add on top of the status ones: the request guards of E10 (a foreign Origin, a wrong CSRF token) and
 * the codes of the first-run setup (E19-S06, E19-S11), which the setup page (E19-S07) has a message and a remedy for.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const DOMAIN_ERROR_CODES = ['origin_not_allowed', 'csrf_invalid', ...Object.values(SETUP_ERROR_CODES)] as const;

/**
 * The codes the web client makes up itself (E17-S04) for a failure that carries no code of the server's: every 401
 * (`unauthenticated`), a body that is not the envelope (`unexpected_response`), a request that never got an answer
 * (`network`) and a body that does not match its contract (`contract`).
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const CLIENT_ERROR_CODES = ['unauthenticated', 'network', 'contract', 'unexpected_response'] as const;

/** A code the web app has a message for. */
export type ErrorCode =
  | (typeof STATUS_ERROR_CODES)[keyof typeof STATUS_ERROR_CODES]
  | (typeof DOMAIN_ERROR_CODES)[number]
  | (typeof CLIENT_ERROR_CODES)[number];

/**
 * Every code, status ones first.
 * @internal Exported for the catalog test (Knip ignores `@internal` exports in production mode).
 */
export const ERROR_CODES: readonly ErrorCode[] = [
  ...Object.values(STATUS_ERROR_CODES),
  ...DOMAIN_ERROR_CODES,
  ...CLIENT_ERROR_CODES,
];

const KNOWN = new Set<string>(ERROR_CODES);

/** Whether `code` is one the app has a message for. A code from a server that is newer than the app is not, and gets the generic message. */
export function isErrorCode(code: string): code is ErrorCode {
  return KNOWN.has(code);
}
