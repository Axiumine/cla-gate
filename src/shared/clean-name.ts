// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// The one cleaning that a name typed by a person goes through (a CLA document's name, E12-S01; a signer's name, E13-S03), so
// every screen that previews it and the server that stores it agree. A name is display text: it is stored as the person typed
// it once cleaned, and every output escapes it for its own context (E09, E16, E18).

/**
 * What a name may not hold: the control characters (C0 and C1, tab and line feed included), the line and paragraph
 * separators, and the bidirectional embeddings, overrides and isolates (U+202A to U+202E, U+2066 to U+2069), which
 * reorder the text around them and let a name read as another one.
 */
const FORBIDDEN = /[\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069]/u;

/** A run of whitespace of any kind. The characters that FORBIDDEN refuses are gone by the time this runs. */
const WHITESPACE_RUN = /\s+/gu;

/**
 * The name that is stored for `raw`, or `null` when `raw` cannot be a name. Cleaning order: a string with a lone surrogate
 * is refused (the database cannot hold it), then NFC normalisation, then the characters of FORBIDDEN are refused, then the
 * ends are trimmed and each whitespace run becomes one space, and the result must be 1 to `maxCodePoints` code points
 * (counted as code points, not UTF-16 units). Anything else, hostile text included (`<script>`, a formula, a mention), is a
 * valid name and is returned unchanged.
 */
export function cleanName(raw: string, maxCodePoints: number): string | null {
  if (!raw.isWellFormed()) {
    return null;
  }
  const composed = raw.normalize('NFC');
  if (FORBIDDEN.test(composed)) {
    return null;
  }
  const name = composed.trim().replaceAll(WHITESPACE_RUN, ' ');
  // A code point takes one or two UTF-16 units, so a name of more than twice the limit in units is over it without counting.
  if (name.length === 0 || name.length > 2 * maxCodePoints) {
    return null;
  }
  return Array.from(name).length <= maxCodePoints ? name : null;
}
