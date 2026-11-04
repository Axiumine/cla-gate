// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { isIP } from 'node:net';

// The optional network metadata of a signing (E13-S05): the address the sign request came from and its User-Agent. Both are
// personal data, so they are read from the request only when the operator switched `RECORD_NETWORK_METADATA` on, and they are
// stored on `signer_pii` (erasable, purged after the retention of E16-S05) and nowhere else. Whatever a client sends is cleaned
// here, before it reaches a column: a header is the client's text, and a value the database refuses would fail the signing.

/** What is stored next to the personal data of a signature. `null` is "not recorded", for either value. */
export interface NetworkMetadata {
  /** The address as Fastify resolved it from the socket and the `TRUST_PROXY` setting, in the text form `inet` takes. */
  readonly ipAddress: string | null;
  /** The cleaned `User-Agent`: no control character, at most {@link USER_AGENT_MAX_LENGTH} characters. */
  readonly userAgent: string | null;
}

/**
 * The value of a signing when recording is off, and of one with nothing to record.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export const NO_NETWORK_METADATA: NetworkMetadata = { ipAddress: null, userAgent: null };

/**
 * The most characters of a user agent that are stored: the limit of `signer_pii_user_agent_length` (migration 014).
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export const USER_AGENT_MAX_LENGTH = 512;

/** The part of a request that holds network metadata. A Fastify request fits it; a test double can too. */
export interface NetworkSource {
  readonly ip: string;
  readonly headers: { readonly 'user-agent'?: string | undefined };
}

/**
 * C0 and C1 controls (`\p{Cc}`: NUL, newline, tab, escape, DEL), which a log line, a CSV cell or the database would take as
 * structure, and the line and paragraph separators, which break a line like a newline does.
 */
const UNSAFE = /[\p{Cc}\p{Zl}\p{Zp}]/gu;

/**
 * The user agent as it is stored: control characters removed (not replaced, so a newline cannot split a value into two), then
 * cut to {@link USER_AGENT_MAX_LENGTH} characters. The cut counts code points, as the `length` of the database does, so a
 * pair of surrogates is never split and the check of the column holds for every input.
 * @returns the cleaned text, or `null` when the header is missing or nothing is left of it.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export function cleanUserAgent(raw: string | undefined): string | null {
  if (raw === undefined) {
    return null;
  }
  const kept = Array.from(raw.replaceAll(UNSAFE, '')).slice(0, USER_AGENT_MAX_LENGTH).join('');
  return kept === '' ? null : kept;
}

/**
 * The address as `inet` takes it. Fastify's `ip` is the socket's address, or, behind a trusted proxy, the entry of
 * `X-Forwarded-For` that the setting selects, and that entry is the client's text: it is kept only when it is an IPv4 or an
 * IPv6 address. A scope (`fe80::1%eth0`) is not one for the database.
 * @returns the address unchanged (an IPv4-mapped IPv6 address stays as it is), or `null` for anything else.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export function cleanAddress(raw: string): string | null {
  return isIP(raw) !== 0 && !raw.includes('%') ? raw : null;
}

/**
 * What to store for the request. With `record` false the request is not read at all, not even to see that a header is missing,
 * so no code path can leak a value into a signing when the operator has not asked for it. With `record` true the address is
 * the resolved one of the request and the user agent is the cleaned header.
 */
export function networkMetadataOf(request: NetworkSource, record: boolean): NetworkMetadata {
  if (!record) {
    return NO_NETWORK_METADATA;
  }
  return { ipAddress: cleanAddress(request.ip), userAgent: cleanUserAgent(request.headers['user-agent']) };
}
