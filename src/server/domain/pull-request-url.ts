// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// Where a pull request is on GitHub (E13-S02), pure. The address is built from the `owner/name` snapshot of a repository and the
// number of the pull request, and from nothing else, so it can only ever point at github.com.

/** `owner/name`: the characters GitHub allows in a login and in a repository name, and a name that is neither `.` nor `..`. */
const FULL_NAME = /^(?<owner>[\w-]{1,100})\/(?!\.{1,2}$)(?<name>[\w.-]{1,100})$/u;

/**
 * `https://github.com/<fullName>/pull/<prNumber>`, or `null` when `fullName` is not an `owner/name` of such characters: the
 * snapshot is data from GitHub, and a value that could change the host or the path of the address is not put into one.
 */
export function pullRequestUrl(fullName: string, prNumber: number): string | null {
  const parts = FULL_NAME.exec(fullName)?.groups;
  return parts === undefined ? null : `https://github.com/${parts['owner']}/${parts['name']}/pull/${prNumber}`;
}
