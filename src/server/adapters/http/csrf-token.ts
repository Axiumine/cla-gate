// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import crypto from 'node:crypto';
import type { Secret } from '../../config/secret.ts';

// The CSRF token of a session (E10-S03): derived, never stored. The session row holds a random `csrf_secret`; the token is
// an HMAC of it under `SESSION_SECRET`, so a leaked table gives no token, a rotated secret invalidates every token, and a
// token of one session means nothing in another.

/** `base64url(hmac_sha256(SESSION_SECRET, "csrf:" + csrf_secret))`: 43 characters. */
export function csrfToken(sessionSecret: Secret, csrfSecret: string): string {
  return crypto.createHmac('sha256', sessionSecret.reveal()).update(`csrf:${csrfSecret}`).digest('base64url');
}

/**
 * Whether what a request presented in `x-csrf-token` is the session's token. Anything that is not a string is a no.
 * `timingSafeEqual` throws on buffers of unequal length, so the lengths (not secret) are compared first and a wrong
 * length is refused without throwing.
 */
export function csrfTokenMatches(sessionSecret: Secret, csrfSecret: string, presented: unknown): boolean {
  if (typeof presented !== 'string') {
    return false;
  }
  const expected = Buffer.from(csrfToken(sessionSecret, csrfSecret));
  const given = Buffer.from(presented);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}
