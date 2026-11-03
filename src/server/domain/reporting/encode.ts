// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// E09-S01: the only functions that put user-controlled text into output GitHub shows (a Check Run, a pull request comment, a
// merge group summary). A login, a name or a trailer is whatever its owner typed, so it reaches GitHub through `renderName`
// (a name, as exactly one Markdown code span) or `neutraliseText` (free text that is not a name), and a commit SHA and a
// numeric id through `shortSha` and `renderId`. Nothing else formats user text, and nothing here reads or prints an email
// address on purpose: one that arrives as a name is only text, and its `@` is made inert like every other. The Markdown
// building blocks (the code span, the escaping, the cut by code points) are in markup.ts.

import { breakHtmlComments, breakMentions, codeSpan, escapeMarkdown, takeCodePoints } from './markup.ts';

/** A name longer than this many code points is cut. */
const NAME_LIMIT = 64;

/** Free text longer than this many code points is cut. */
const TEXT_LIMIT = 200;

/** Shown for a name that is empty once cleaned. */
const UNNAMED = '(unnamed)';

/** What marks a name that was cut. */
const ELLIPSIS = '…';

/**
 * Characters that must not reach the output: C0 and C1 controls (`\p{Cc}`, which includes DEL), the line and paragraph
 * separators (`\p{Zl}` is U+2028, `\p{Zp}` is U+2029) and the bidirectional controls (U+202A to U+202E, U+2066 to U+2069,
 * written one by one: a range of braced escapes defeats the regular expression linter).
 */
const UNSAFE = /[\p{Cc}\p{Zl}\p{Zp}\u{202a}\u{202b}\u{202c}\u{202d}\u{202e}\u{2066}\u{2067}\u{2068}\u{2069}]/gu;

/** Every kind of line break: CRLF counts once. */
const LINE_BREAK = /\r\n|[\n\v\f\r\u0085\p{Zl}\p{Zp}]/gu;

/** A full commit SHA: 40 hex digits (SHA-1) or 64 (SHA-256), lower case. */
const COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** How many characters of a SHA are shown. */
const SHORT_SHA_LENGTH = 7;

/** Thrown by {@link shortSha} for text that is not a full, lower-case commit SHA. Carries no part of the text. */
export class InvalidShaError extends Error {
  override readonly name = 'InvalidShaError';

  constructor() {
    super('Not a full lower-case commit SHA');
  }
}

/** Thrown by {@link renderId} for a number that is not a safe integer. Carries no part of the number. */
export class InvalidIdError extends Error {
  override readonly name = 'InvalidIdError';

  constructor() {
    super('Not a safe integer id');
  }
}

/**
 * A name (a login, a display name, the name of a co-author) as exactly one line of Markdown: one inline code span.
 *
 * The cleaning, in this order: lone surrogates become U+FFFD; C0 and C1 controls, U+2028, U+2029 and the bidirectional
 * controls are removed; each run of whitespace becomes one space; the ends are trimmed; the name is cut to 64 code points and
 * `…` is appended when it was; U+200B follows every `@` and `#` (inside the span too, so a renderer that ignores the span
 * still cannot mention or link) and splits every `<!--`, so a name never spells the comment marker of E09-S07. The fence is
 * one backtick longer than the longest run of backticks in the text, and text that starts or ends with a backtick gets a
 * space each side. A name that is empty after cleaning is `(unnamed)`.
 */
export function renderName(raw: string): string {
  const cleaned = raw.toWellFormed().replace(UNSAFE, '').replace(/\s+/gu, ' ').trim();
  if (cleaned === '') {
    return codeSpan(UNNAMED);
  }
  const { head, cut } = takeCodePoints(cleaned, NAME_LIMIT);
  return codeSpan(breakHtmlComments(breakMentions(cut ? `${head}${ELLIPSIS}` : head)));
}

/**
 * Free text that is not a name (the advisory text of a trailer) made safe to put into Markdown: line breaks become spaces
 * (CRLF is one break), lone surrogates, controls and bidirectional controls are dropped, the text is cut to 200 code points,
 * every character of ``\ ` * _ [ ] ( ) < > # + - . ! | ~ &`` gets a backslash and U+200B follows every `@` and `#`. The cut is
 * made before the escaping, so an escape is never split.
 */
export function neutraliseText(raw: string): string {
  const flat = raw.toWellFormed().replace(LINE_BREAK, ' ').replace(UNSAFE, '');
  return escapeMarkdown(takeCodePoints(flat, TEXT_LIMIT).head);
}

/**
 * The first 7 characters of a commit SHA, for display.
 * @throws InvalidShaError when `sha` is not 40 (or 64) lower-case hex digits; the text shown is never anything else.
 */
export function shortSha(sha: string): string {
  if (!COMMIT_SHA.test(sha)) {
    throw new InvalidShaError();
  }
  return sha.slice(0, SHORT_SHA_LENGTH);
}

/**
 * A numeric id (a GitHub id, a pull request number, a count) as text.
 * @throws InvalidIdError when `id` is not a safe integer, so a rounded or non-numeric value is never printed.
 */
export function renderId(id: number): string {
  if (!Number.isSafeInteger(id)) {
    throw new InvalidIdError();
  }
  return String(id);
}
