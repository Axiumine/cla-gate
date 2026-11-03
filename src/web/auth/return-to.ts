// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { LOGIN_FAILED_PATH } from '../../shared/auth.ts';
import { LOGIN_PATH, LOGIN_RETURN_TO_PARAM } from '../../shared/auth-contract.ts';

// Where a login ends (E17-S08). The page puts the path it is on into `return_to` of the login start, and the server checks
// it again before it believes it (E10-S04). This is the same rule, applied before a hostile value leaves the page: a value
// that fails it is replaced by `/`, never sent, and never an error.

const MAX_LENGTH = 512;

/** A backslash (browsers read it as a slash), a control character (C0, DEL and C1) or whitespace. */
const FORBIDDEN = /[\\\p{Cc}\s]/u;

/** A single leading slash and none of the characters above: what `//evil.example` and `/\evil.example` both fail. */
function isPlainPath(text: string): boolean {
  return text.startsWith('/') && !text.startsWith('//') && !FORBIDDEN.test(text);
}

/** The text with its percent-escapes decoded, or `undefined` when they are malformed. */
function decoded(text: string): string | undefined {
  try {
    return decodeURIComponent(text);
  } catch {
    return undefined;
  }
}

/**
 * The path to hand to the login start: `raw` itself when it is a plain path of this site, else `/`. It must start with one
 * `/`, hold no backslash, control character or whitespace, and be at most 512 characters; its percent-decoded form must pass
 * the same rules (`/%5Cevil`, `/%2Fevil.example` and `/%0d%0aSet-Cookie:x` hide what the plain text does not show).
 */
export function buildReturnTo(raw: string): string {
  if (raw.length > MAX_LENGTH || !isPlainPath(raw)) {
    return '/';
  }
  const unescaped = decoded(raw);
  return unescaped !== undefined && isPlainPath(unescaped) ? raw : '/';
}

/**
 * The address of the login start (E10-S04), with `return_to` set to `returnTo` once it has passed {@link buildReturnTo}.
 * Without a path the parameter is left out, and the server sends the person to the front page. The address is for a link or
 * a full-page navigation: the login redirects to GitHub, so client routing cannot follow it.
 */
export function loginStartUrl(returnTo?: string): string {
  if (returnTo === undefined) {
    return LOGIN_PATH;
  }
  return `${LOGIN_PATH}?${LOGIN_RETURN_TO_PARAM}=${encodeURIComponent(buildReturnTo(returnTo))}`;
}

/**
 * The `returnTo` for a login link on the page at `pathname` and `searchStr` (the path and the query string with its `?`): the
 * page itself, so the person comes back to it. The page that reports a failed login has none, because landing on it again
 * after a good login would tell them it failed.
 */
export function returnPathOf(pathname: string, searchStr: string): string | undefined {
  return pathname === LOGIN_FAILED_PATH ? undefined : `${pathname}${searchStr}`;
}
