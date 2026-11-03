// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// What `UserText` does to a string before it reaches the screen (E17-S11). Two pure steps: show the characters that change
// how text is drawn instead of drawing them, and cut a long text at a whole character. Neither touches the stored value:
// the caller's string is only read.

/**
 * The characters that are shown as a placeholder: C0 and C1 controls (category Cc, which also holds DEL) except the newline,
 * the lone surrogates (category Cs: with the `u` flag a valid pair is one code point and never matches), and the bidirectional
 * and byte-order formatting characters: U+200E and U+200F (the marks), U+202A to U+202E (embeddings and overrides),
 * U+2066 to U+2069 (isolates) and U+FEFF. The zero width joiner U+200D is not among them: emoji sequences need it.
 */
const HIDDEN = /(?!\n)[\p{Cc}\p{Cs}\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/gu;

/** The placeholder `<U+XXXX>` for a character: its code unit in at least four capital hexadecimal digits. Every character matched above is one code unit. */
const placeholder = (char: string): string => `<U+${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}>`;

/** `text` with each hidden character written out as `<U+XXXX>`; everything else, a 4-byte emoji included, is untouched. */
export function visibleText(text: string): string {
  return text.replace(HIDDEN, placeholder);
}

/** The sign of a cut. */
const ELLIPSIS = '\u2026';

/** Cuts at the edge of a character as a person counts it, so an emoji built of several code points is never halved. */
const characters = new Intl.Segmenter('en', { granularity: 'grapheme' });

/**
 * The first `maxLength` characters of `text`, made visible, and an ellipsis; `null` when `text` is no longer than
 * `maxLength`, so nothing is cut. A character is what a person sees as one: a family emoji is one. A hidden character
 * counts as one too, and its placeholder is never cut in the middle.
 */
export function clipText(text: string, maxLength: number): string | null {
  if (!Number.isInteger(maxLength) || maxLength < 1) {
    throw new RangeError(`maxLength must be a whole number of at least 1, not ${String(maxLength)}`);
  }
  // A text is never more characters than UTF-16 units, so a short one needs no segmentation.
  if (text.length <= maxLength) {
    return null;
  }
  const parts = Array.from(characters.segment(text), ({ segment }) => segment);
  if (parts.length <= maxLength) {
    return null;
  }
  return `${visibleText(parts.slice(0, maxLength).join(''))}${ELLIPSIS}`;
}
