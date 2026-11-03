// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ClaRule } from './cla.ts';

// The text of a CLA (E12-S02). The text that is stored is the text that is hashed and shown, so it is made canonical once, in
// this one place, and the editor of the web project and the server import the same functions and so agree. The hash is over
// the canonical text (the server computes it, see `sha256Hex`); the rules a text can break are answered by name and, for the
// size, with the two numbers a person needs to cut the text (`CLA_RULE_STATUS` gives each its status).

/** The most UTF-8 bytes a CLA text may hold once canonical: 200 KiB. */
export const CLA_TEXT_MAX_BYTES = 204_800;

const BYTE_ORDER_MARK = 0xfeff;
const LINE_FEED = 0x0a;
const TAB = 0x09;
/** The first code point that is not a C0 control character. */
const FIRST_PRINTABLE = 0x20;

/** Any character that is not white space: a text without one says nothing. */
const NON_WHITESPACE = /\S/u;

/** A carriage return with the line feed after it, or one alone: each is one line ending. */
const LINE_ENDING = /\r\n?/g;

/**
 * The canonical form of `md`: a leading byte order mark is removed, every CRLF and every lone CR becomes LF, and the text
 * ends in exactly one LF. Nothing else changes: the lines inside are not trimmed (two spaces at the end of a line are a
 * Markdown line break), nothing is Unicode-normalised, and a text with no line at all (an empty one) becomes a single LF.
 * Idempotent: a run of byte order marks at the start is removed whole, so a second call has none left to remove. The two
 * ends are found by scanning, not by a pattern, so a text of a few hundred thousand line feeds costs a pass and not a square.
 */
export function canonicalise(md: string): string {
  let start = 0;
  while (md.charCodeAt(start) === BYTE_ORDER_MARK) {
    start += 1;
  }
  const lines = md.slice(start).replaceAll(LINE_ENDING, '\n');
  let end = lines.length;
  while (end > 0 && lines.charCodeAt(end - 1) === LINE_FEED) {
    end -= 1;
  }
  return `${lines.slice(0, end)}\n`;
}

/** The rules of the text that a request can break, the ones in `CLA_RULE_STATUS` whose name starts with `content_`. */
type ContentRule = Extract<ClaRule, `content_${string}`>;

/**
 * What is wrong with a text. Only the size has details, the two numbers of `422 content_too_large`: the limit and the bytes
 * the text has, never a part of the text. The details are written inline, so that they are a plain JSON object for the
 * `details` of an error body (an interface would not be assignable to one).
 */
export type ClaTextProblem =
  | {
      readonly rule: Extract<ContentRule, 'content_too_large'>;
      readonly details: { readonly limitBytes: number; readonly actualBytes: number };
    }
  | { readonly rule: Exclude<ContentRule, 'content_too_large'> };

/** True when `md` holds a C0 control character that is neither LF nor TAB (NUL included). A CR counts: a canonical text has none. */
function hasForbiddenControl(md: string): boolean {
  for (let index = 0; index < md.length; index += 1) {
    const unit = md.charCodeAt(index);
    if (unit < FIRST_PRINTABLE && unit !== LINE_FEED && unit !== TAB) {
      return true;
    }
  }
  return false;
}

/**
 * The first rule the canonical text `md` breaks, or `null` when it is a valid CLA text. Checked in this order: more than
 * `CLA_TEXT_MAX_BYTES` bytes of UTF-8 (`content_too_large`), no character that is not white space (`content_empty`), a NUL or
 * another C0 control character but LF and TAB, or a lone surrogate, which no UTF-8 text can hold and the database would
 * store as another character than the one hashed (`content_invalid_characters`). The problem never carries the text.
 */
export function validateClaText(md: string): ClaTextProblem | null {
  const actualBytes = new TextEncoder().encode(md).byteLength;
  if (actualBytes > CLA_TEXT_MAX_BYTES) {
    return { rule: 'content_too_large', details: { limitBytes: CLA_TEXT_MAX_BYTES, actualBytes } };
  }
  if (!NON_WHITESPACE.test(md)) {
    return { rule: 'content_empty' };
  }
  if (!md.isWellFormed() || hasForbiddenControl(md)) {
    return { rule: 'content_invalid_characters' };
  }
  return null;
}
