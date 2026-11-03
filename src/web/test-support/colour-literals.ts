// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// Finds colour literals in source text (E17-S05): the design tokens of tokens.css are the only place a colour is written,
// so a component names a role and follows the theme. Used by the test that reads every file of src/web.

/**
 * A hash and three, four, six or eight hex digits. Not after a word character, nor after `&` or `#` (a character reference
 * such as an ampersand, a hash and 27 in hex), and not when more name follows. A link to an anchor whose whole name is hex digits and
 * has the right length (add, bad, fade) still looks like a colour: name the anchor otherwise.
 */
const HEX = /(?<![\w&#])#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{3,4})(?![\w-])/giu;

/** A colour function: one of these names (rgb, rgba, hsl, hsla, hwb, lab, lch, oklab, oklch, color) and an opening parenthesis. */
const FUNCTION = /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/giu;

/** Each colour literal in `text`, in order of appearance (a function is reported by its name and its parenthesis). */
export function findColourLiterals(text: string): string[] {
  return [...text.matchAll(HEX), ...text.matchAll(FUNCTION)].sort((a, b) => a.index - b.index).map((match) => match[0]);
}

/**
 * `#` and the digits, for a test that needs a colour as data. A test writes its colours through this, so that no colour
 * literal stands in the source of src/web outside tokens.css, which is what the scan of every file checks.
 */
export function hexColour(digits: string): string {
  return `#${digits}`;
}
