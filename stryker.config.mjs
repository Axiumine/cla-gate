// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// The mutation gate (E20-S04, E20-S05): `yarn mutate` is `stryker run --incremental`. Mutation testing proves the 100%
// coverage gate is real, because a test that only executes a line leaves its mutants alive. Mutation never runs in a git
// hook: only the `mutation` CI job runs it.
//
// Two scopes, chosen by the environment variable STRYKER_SCOPE:
//   unset (or `server`)  server and shared code (E20-S04): `yarn mutate`. The web project joins the scope when a plan
//                        exists for it.
//   `scripts`            the code caps tool, a gate in itself (E20-S05): `yarn mutate:scripts`.
// Any other value throws: a typo must never run the wrong scope and pass.
//
// `--logLevel debug` is never used: it crashes with Vitest 5 (Stryker issue 6272).

import process from 'node:process';

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const SERVER_SCOPE = {
  // The Vitest config selects the node `server` project only (Stryker forces coverage off and cannot drive jsdom).
  vitest: { configFile: 'vitest.stryker.config.ts' },
  tsconfigFile: 'tsconfig.server.json',
  mutate: [
    'src/server/**/*.ts',
    'src/shared/**/*.ts',
    '!src/**/*.test.ts',
    '!src/**/test-support.ts',
    '!src/**/global-setup.ts',
  ],
  incrementalFile: 'reports/stryker-incremental.json',
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
};

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const SCRIPTS_SCOPE = {
  // The `scripts` Vitest project only, and the checker reads the scripts tsconfig project.
  vitest: { configFile: 'vitest.stryker-scripts.config.ts' },
  tsconfigFile: 'tsconfig.scripts.json',
  mutate: [
    'scripts/check-code-caps.ts',
    'scripts/code-caps/*.ts',
    '!scripts/code-caps/*.test.ts',
    '!scripts/code-caps/test-support.ts',
  ],
  incrementalFile: 'reports/stryker-incremental-scripts.json',
  // Under reports/mutation/ so that the one uploaded artifact holds both reports without one overwriting the other.
  htmlReporter: { fileName: 'reports/mutation/scripts/index.html' },
  jsonReporter: { fileName: 'reports/mutation/scripts/mutation.json' },
};

/**
 * The options of one scope; `undefined` is the server scope. Exported for the tests, which cannot read the default export
 * for a scope other than the one the environment of the current run selects.
 * @param {string | undefined} scope
 * @returns {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
export function strykerOptions(scope) {
  if (scope !== undefined && scope !== 'server' && scope !== 'scripts') {
    throw new Error(`STRYKER_SCOPE must be unset, "server" or "scripts", not ${JSON.stringify(scope)}`);
  }
  return {
    testRunner: 'vitest',
    checkers: ['typescript'],
    coverageAnalysis: 'perTest',
    // Never lowered (E20-S04): a score below `break` fails the run.
    thresholds: { high: 95, low: 90, break: 90 },
    incremental: true,
    tempDirName: '.stryker-tmp',
    reporters: ['clear-text', 'html', 'json'],
    // The list of tests that ran per mutant is thousands of lines of log in CI; the survivors and the score are what matter.
    clearTextReporter: { logTests: false },
    ...(scope === 'scripts' ? SCRIPTS_SCOPE : SERVER_SCOPE),
  };
}

export default strykerOptions(process.env['STRYKER_SCOPE']);
