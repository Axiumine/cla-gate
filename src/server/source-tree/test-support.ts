// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// No import on purpose: the mutation gate's tests under scripts/ use this file too, and an import of a test helper that needs the
// Vitest `inject` types would pull those into the scripts project.

/** The copy of the repository that Stryker runs the tests in: `<repository>/.stryker-tmp/sandbox-<id>` (`tempDirName` in stryker.config.mjs). */
const STRYKER_SANDBOX = /[\\/]\.stryker-tmp[\\/]sandbox-[^\\/]+(?=[\\/]|$)/;

/**
 * `directory` in the repository itself. Stryker runs the tests in a copy of the repository whose mutated files are instrumented:
 * every mutant of a file is in it behind a switch, and a string that was the argument of a call is a conditional expression. A
 * scan of the source that read the copy would be reading that, and not the code as written, and would report what is not in the
 * code. A test that scans the source takes its root from here: the same directory of the repository, which Stryker leaves
 * alone. Outside a sandbox the answer is `directory`.
 */
export function sourceTree(directory: string): string {
  return directory.replace(STRYKER_SANDBOX, '');
}
