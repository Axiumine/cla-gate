// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// E08-S06: what the engine knows about the email of a `Co-authored-by` trailer. This module and trailers.ts are the only
// places in the engine where text is matched. That is allowed here, and only here, because a trailer is spoofable text:
// anyone can write any trailer into a commit message, so nothing in it can ever grant coverage, and ignoring a trailer
// only removes a requirement that the same text could have added. The one thing that is resolved, the numeric id in a
// GitHub noreply address, names an account that must then be covered like anyone else.

const NOREPLY_DOMAIN = '@users.noreply.github.com';

/**
 * The form GitHub gives every account that keeps its email private, `ID+login@users.noreply.github.com`, checked against
 * GitHub's documentation on 2026-11-02 (accounts created after 2017-07-18 have it; older ones also have the legacy
 * `login@users.noreply.github.com` without an id, which names no number and is never resolved). The id is written
 * without leading zeros and must be a safe integer (checked after matching); the login is at most 39 characters. The
 * domain is case-insensitive. There is no `u` flag, so no non-ASCII letter folds into an ASCII one. A login ending in
 * `[bot]` never reaches this pattern: such trailers are ignored first.
 */
const NOREPLY_WITH_ID = /^([1-9]\d*)\+[a-z0-9_-]{1,39}@users\.noreply\.github\.com$/i;

/**
 * Trailers that are never about a person who must sign, so they give neither an actor nor an advisory. An `address`
 * entry is a whole lower-case email; a `noreply_login` entry is a lower-case login in the noreply form whatever its id
 * (an account can be seen with more than one id). Login and email are matched, never an id, because the id of such a
 * trailer is exactly what is not known in advance. A login ending in `[bot]` is ignored as a rule, not by entry.
 */
export const IGNORED_TRAILER_IDENTITIES = [
  // Claude Code writes `Co-Authored-By: Claude <noreply@anthropic.com>`.
  { kind: 'address', value: 'noreply@anthropic.com' },
  // GitHub Copilot: `Copilot <ID+Copilot@users.noreply.github.com>`. Verified on 2026-11-02 with `GET /user/{id}`: the
  // ids 175728472 and 223556219 are both the account `Copilot` of type `Bot`, which is why the id is not in the entry.
  { kind: 'noreply_login', value: 'copilot' },
] as const;

type IgnoredIdentity = (typeof IGNORED_TRAILER_IDENTITIES)[number];

/** The login of a noreply address (with or without an id), lower case, or `null` for any other address. */
function noreplyLogin(lowerEmail: string): string | null {
  if (!lowerEmail.endsWith(NOREPLY_DOMAIN)) {
    return null;
  }
  const local = lowerEmail.slice(0, -NOREPLY_DOMAIN.length);
  // Without a `+` the index is -1 and the whole local part is the login (the legacy form).
  return local.slice(local.indexOf('+') + 1);
}

function isIgnoredBy(identity: IgnoredIdentity, lowerEmail: string): boolean {
  return identity.kind === 'address' ? lowerEmail === identity.value : noreplyLogin(lowerEmail) === identity.value;
}

/** True for a bot or an AI tool: a noreply login ending in `[bot]`, or an entry of `IGNORED_TRAILER_IDENTITIES`. */
export function isIgnoredTrailerEmail(email: string): boolean {
  const lowerEmail = email.toLowerCase();
  return (
    noreplyLogin(lowerEmail)?.endsWith('[bot]') === true ||
    IGNORED_TRAILER_IDENTITIES.some((identity) => isIgnoredBy(identity, lowerEmail))
  );
}

/**
 * The numeric GitHub id of an `ID+login@users.noreply.github.com` address, or `null` for anything else: the legacy form
 * without an id, any other address, an id of 0, a leading zero, an id above the safe range, a login of more than 39
 * characters. The login is checked for shape and never used.
 */
export function noreplyAccountId(email: string): number | null {
  const digits = NOREPLY_WITH_ID.exec(email)?.[1];
  if (digits === undefined) {
    return null;
  }
  const githubId = Number(digits);
  return Number.isSafeInteger(githubId) ? githubId : null;
}
