// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// E09-S03: the names a report shows, which the evaluation does not carry. The engine (E08) decides on numeric ids and keeps
// no login, so the job hands the reporter this lookup next to the evaluation, built from what it fetched anyway: the pull
// request, its commits and their messages. It lives for one report and is never stored. Every string in it is text that
// someone chose, so the only way it reaches output is `renderName` (E09-S01).

/**
 * The display-only names of one report.
 * - `logins`: the login each account was seen under, by numeric GitHub id. An id the job did not see has none, and is shown
 *   as an unnamed account beside its id.
 * - `coAuthors`: the names written in the `Co-authored-by` trailers that could not be resolved to an account, by lower-case
 *   commit SHA. Only the name before the address is in it, never the address.
 */
export interface DisplayNames {
  readonly logins: ReadonlyMap<number, string>;
  readonly coAuthors: ReadonlyMap<string, readonly string[]>;
}
