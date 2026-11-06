// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { canonicalise } from '../../shared/cla-text.ts';

// The fingerprint of a CLA text as the browser computes it before publishing (E18-S05): SHA-256 over the UTF-8 bytes of the
// canonical text, which is the text the server stores from a draft and hashes (E12-S02), so the preview and the version agree.

const HEX_DIGITS = 2;

/**
 * The lower-case hexadecimal SHA-256 of the UTF-8 bytes of `text`.
 * @throws when the browser has no `crypto.subtle` (a page that is not a secure context).
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(HEX_DIGITS, '0')).join('');
}

/** The hash the server will record for a draft saved from `text`: SHA-256 of the canonical form of the text. */
export function contentHashOf(text: string): Promise<string> {
  return sha256Hex(canonicalise(text));
}
