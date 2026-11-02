// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// E20-S16: what counts as a written justification. A comment explains its escape hatch after a ` -- ` separator, the
// same separator ESLint directives use for their description.

/**
 * Shortest text, in characters, that counts as a reason. The ESLint `ban-ts-comment` option uses the same number.
 * @internal Exported for the ESLint config block and the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const MIN_REASON_LENGTH = 10;

const SEPARATOR = /(?:^|\s)-{2,}(?:\s|$)/;
const PRESERVE = /(?:^|\s)-{2,}\s+@preserve(?![\w-])/;

const collapse = (text: string): string => text.replaceAll(/\s+/g, ' ').trim();

/** The comment's text after `//` or between the delimiters of a block comment, on one line, without leading `*`. */
export function commentBody(raw: string): string {
  if (raw.startsWith('//')) {
    return collapse(raw.slice(2));
  }
  return collapse(raw.slice(2, -2).replaceAll(/^[ \t]*\*+/gm, ' '));
}

/**
 * The text of a directive from its first word to the end of the comment (or line) that holds it, on one line, without
 * the comment's closing delimiter or the leading `*` of a JSDoc line.
 */
export function directiveText(raw: string): string {
  return collapse(raw.replace(/\*\/$/, '').replaceAll(/^[ \t]*\*+/gm, ' '));
}

/**
 * The text after the first ` -- ` of a comment body, or `undefined` when there is no separator.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export function reasonOf(body: string): string | undefined {
  const match = SEPARATOR.exec(body);
  return match === null ? undefined : body.slice(match.index + match[0].length).trim();
}

/** True when the comment has a ` -- ` separator followed by at least {@link MIN_REASON_LENGTH} characters. */
export function hasReason(body: string): boolean {
  return (reasonOf(body)?.length ?? 0) >= MIN_REASON_LENGTH;
}

/** True when the comment says `-- @preserve`, the marker that keeps a bundler from stripping it. */
export function hasPreserve(body: string): boolean {
  return PRESERVE.test(body);
}

/** True when text of at least {@link MIN_REASON_LENGTH} characters follows `-- @preserve`. */
export function hasReasonAfterPreserve(body: string): boolean {
  const match = PRESERVE.exec(body);
  if (match === null) {
    return false;
  }
  const rest = body.slice(match.index + match[0].length).replace(/^[\s:;,.-]+/, '');
  return rest.length >= MIN_REASON_LENGTH;
}
