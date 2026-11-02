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
