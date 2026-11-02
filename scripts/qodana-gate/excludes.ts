// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// E20-S08: qodana.yaml has no baseline file, so a finding that is not fixed is excluded in the file itself, and every
// exclusion says why in the comment line directly above it.

const TOP_LEVEL_KEY = /^[A-Za-z]/;
const ENTRY = /^ {2}- /;

/**
 * The entries of the top-level `exclude:` list of a qodana.yaml text that have no comment line directly above them
 * (each entry as written, trimmed). A text without an `exclude:` list has none.
 */
export function uncommentedExcludes(text: string): string[] {
  const lines = text.split('\n');
  const start = lines.indexOf('exclude:');
  // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- anchored, linear regex on lines of our own qodana.yaml, not request data
  const next = lines.findIndex((line, index) => index > start && TOP_LEVEL_KEY.test(line));
  const end = next === -1 ? lines.length : next;
  return lines.flatMap((line, index) => {
    const inList = start !== -1 && index > start && index < end;
    const commented = (lines[index - 1] ?? '').trim().startsWith('#');
    // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- anchored, linear regex on lines of our own qodana.yaml, not request data
    return inList && ENTRY.test(line) && !commented ? [line.trim()] : [];
  });
}
