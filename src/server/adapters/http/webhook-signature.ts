// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import crypto from 'node:crypto';
import type { Secret } from '../../config/secret.ts';

/** The two secrets a delivery may be signed with: the current one and, during a rotation, the one being retired. */
export interface WebhookSecrets {
  readonly current: Secret | undefined;
  readonly previous: Secret | undefined;
}

/** Which secret signed a delivery; `none` when neither did, for whatever reason. */
export type SignatureMatch = 'current' | 'previous' | 'none';

/**
 * What GitHub sends in `X-Hub-Signature-256`: `sha256=` and 64 hex digits, always lower case. Anything else is refused
 * without being decoded (an upper-case digit, a trailing space, a wrong length), so a header is never interpreted
 * leniently.
 */
const SIGNATURE = /^sha256=([0-9a-f]{64})$/;

/**
 * `timingSafeEqual` throws on buffers of unequal length, so the length (public) is compared first.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export function sameDigest(expected: Buffer, claimed: Buffer): boolean {
  return expected.length === claimed.length && crypto.timingSafeEqual(expected, claimed);
}

function digestOf(secret: Secret, body: Buffer): Buffer {
  return crypto.createHmac('sha256', secret.reveal()).update(body).digest();
}

/**
 * Checks `X-Hub-Signature-256` against the RAW bytes of the request body (E06-S01): `HMAC-SHA256(secret, body)` for
 * each configured secret, compared with `crypto.timingSafeEqual`. Every configured secret is computed and compared,
 * whichever matches first, so what a delivery proves is never visible in the time the check takes. The legacy SHA-1
 * header is never read. A missing, repeated or malformed header matches nothing, and so does a configuration without
 * any secret: the check fails closed.
 *
 * @param body the raw bytes of the request body, exactly as received
 * @param header the value of the header as the framework hands it over: anything but one string matches nothing
 * @param secrets the current secret and, during a rotation, the one being retired
 */
export function matchWebhookSignature(body: Buffer, header: unknown, secrets: WebhookSecrets): SignatureMatch {
  const hex = typeof header === 'string' ? SIGNATURE.exec(header)?.[1] : undefined;
  if (hex === undefined) {
    return 'none';
  }
  const claimed = Buffer.from(hex, 'hex');
  const signedWith = (secret: Secret | undefined): boolean =>
    secret !== undefined && sameDigest(digestOf(secret, body), claimed);
  // Both are computed before either is looked at: no early exit on the first match.
  const current = signedWith(secrets.current);
  const previous = signedWith(secrets.previous);
  if (current) {
    return 'current';
  }
  return previous ? 'previous' : 'none';
}
