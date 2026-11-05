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
 * separators (`\p{Zl}` is U+2028, `\p{Zp}` is U+2029) and every bidirectional control (`\p{Bidi_Control}`: U+061C, the marks
 * U+200E and U+200F, U+202A to U+202E and U+2066 to U+2069). The property leaves U+200B, U+200C and U+200D, which names in
 * several scripts and emoji need.
 */
const UNSAFE = /[\p{Cc}\p{Zl}\p{Zp}\p{Bidi_Control}]/gu;

/**
 * The tag block, U+E0000 to U+E007F: it draws nothing and can carry hidden text. It is matched as the surrogate pair of each of
 * its characters (a high surrogate U+DB40 and a low one from U+DC00 to U+DC7F), because a range of braced escapes defeats the
 * regular expression linter. Run it on well-formed text only, where a high surrogate always has its low one.
 */
const TAG_BLOCK = /\uDB40[\uDC00-\uDC7F]/g;

/** `text` without the characters of {@link UNSAFE} and of {@link TAG_BLOCK}. */
const withoutUnsafe = (text: string): string => text.replace(UNSAFE, '').replace(TAG_BLOCK, '');

/**
 * Every kind of line break: CRLF counts once. The vertical tab (U+000B) is written `\cK` and not as the usual `\v` escape: the
 * mutation tool rewrites `\v` to `\V`, which the `u` flag rejects when the module loads, and the instrumented module holds every
 * mutant of its file, so the dry run of the `root-domain-ports` shard failed on it (2026-11-04). `\u000B` and `\x0B` are
 * flagged by `no-control-regex`. Another regular expression with a mutant that does not compile fails
 * scripts/mutation-gate/instrumented-regex.test.ts.
 */
const LINE_BREAK = /\r\n|[\n\cK\f\r\u0085\p{Zl}\p{Zp}]/gu;

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
  const cleaned = withoutUnsafe(raw.toWellFormed()).replace(/\s+/gu, ' ').trim();
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
  const flat = withoutUnsafe(raw.toWellFormed().replace(LINE_BREAK, ' '));
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
