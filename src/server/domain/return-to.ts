// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// Where a login ends (E10-S04), pure. `return_to` comes from the address bar of a stranger, so the login start keeps it
// only when it is a path on this very site, and anything else is replaced by `/` instead of being refused: a login link
// with a bad `return_to` still logs the person in, it just lands on the front page.

const MAX_LENGTH = 512;

/** A base the value is resolved against; only its origin matters, and `localhost` never appears in an answer. */
const BASE = 'http://localhost';

/** A backslash (browsers read it as a slash), a control character (the C0 and C1 ranges, DEL included) or whitespace. */
const FORBIDDEN = /[\\\p{Cc}\s]/u;

/** A single leading slash, and none of the characters above: what `//evil.example` and `/\evil.example` both fail. */
function isPlainPath(text: string): boolean {
  return text.startsWith('/') && !text.startsWith('//') && !FORBIDDEN.test(text);
}

/** The text with its percent-escapes decoded, or undefined when they are malformed. */
function decoded(text: string): string | undefined {
  try {
    return decodeURIComponent(text);
  } catch {
    return undefined;
  }
}

/**
 * The path to send a person to after login. The value must start with a single `/`, contain no backslash, control
 * character or whitespace, be at most 512 characters, and resolve under `new URL(raw, 'http://localhost')` to the
 * origin `http://localhost`. Anything else, a missing value included, becomes `/`; it is never an error. A query string
 * is allowed, so `/sign/123?pr=45` survives.
 *
 * Three checks go beyond the text of the value, because the answer ends up in a `Location` header and in a cookie:
 * the percent-decoded value must pass the same character rules (`/%0d%0aSet-Cookie:x` hides a line break), the
 * resolved path must not begin with `//` (`/..//evil.example` is a path on this site that a later reader of it as a
 * link would take for another host), and the resolved path is at most 512 characters too (the parser percent-encodes a
 * character outside ASCII to up to 9, so a value within the bound can resolve to far more, and the signed cookie that
 * carries the answer would outgrow the 4096 bytes a browser keeps). The answer is the resolved path, query and fragment, so it holds only printable
 * ASCII (the parser percent-encodes the rest, and a header with a wider character would throw) and has its `..`
 * segments applied.
 */
export function safeReturnTo(raw: string | undefined): string {
  if (raw === undefined || raw.length > MAX_LENGTH || !isPlainPath(raw)) {
    return '/';
  }
  const unescaped = decoded(raw);
  if (unescaped === undefined || !isPlainPath(unescaped)) {
    return '/';
  }
  // A string that starts with a single `/` has no way to fail parsing against a valid base, so this does not throw.
  const url = new URL(raw, BASE);
  // Stryker disable next-line ConditionalExpression: the origin check is the story's rule, kept as defence in depth; no text that passed the checks above resolves to another origin, so it cannot be seen to fail
  const resolved = url.origin === BASE && isPlainPath(url.pathname) ? `${url.pathname}${url.search}${url.hash}` : '/';
  return resolved.length > MAX_LENGTH ? '/' : resolved;
}
