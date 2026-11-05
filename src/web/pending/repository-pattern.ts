// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// The address of a pull request on GitHub (E18-S08), built from text the server sends: only a repository name that has the shape GitHub gives
// (an owner of letters, digits and hyphens, a slash and a name of letters, digits, dots, underscores and hyphens, never `.` or `..`, which a
// URL parser would resolve) becomes a link. Anything else is shown as text and linked to nothing.

/** `owner/name`: the shape of `repositories.full_name`. The owner is at most 39 characters and the name at most 100, as on GitHub. */
const REPOSITORY_NAME = /^[A-Za-z0-9-]{1,39}\/(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;

/** Where the pull request `number` of `fullName` is on GitHub, or `undefined` when `fullName` does not have the shape of a repository name. */
export function pullRequestUrl(fullName: string, number: number): string | undefined {
  // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- anchored, with bounded counts and no nested quantifier (linear time)
  return REPOSITORY_NAME.test(fullName) ? `https://github.com/${fullName}/pull/${String(number)}` : undefined;
}
