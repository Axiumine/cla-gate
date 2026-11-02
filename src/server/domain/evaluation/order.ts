// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// E08-S02: the one text ordering of the engine. `localeCompare` depends on the host's locale and ICU data, so two
// machines could order the same SHAs differently; a code-unit comparison is the same everywhere.

/** Orders two strings by UTF-16 code unit, which for lower-case hex SHAs and ASCII codes is plain alphabetical order. */
export function compareText(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

/**
 * Orders anything that points at one role of one commit (an unlinked finding, E08-S02, and what E08-S05 makes of it) by
 * SHA, then by role. Both are plain codes, so the order is the same on every machine.
 */
export function compareShaThenRole(
  a: { readonly sha: string; readonly role: string },
  b: { readonly sha: string; readonly role: string },
): number {
  return compareText(a.sha, b.sha) || compareText(a.role, b.role);
}

/** Orders advisories by commit SHA, then by code (E08-S06), plain codes again, so the order is the same everywhere. */
export function compareAdvisories(
  a: { readonly sha: string; readonly code: string },
  b: { readonly sha: string; readonly code: string },
): number {
  return compareText(a.sha, b.sha) || compareText(a.code, b.code);
}
