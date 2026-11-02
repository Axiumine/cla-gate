// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// The mutation gate (E20-S04): `yarn mutate` is `stryker run --incremental`. Mutation testing proves the 100% coverage
// gate is real, because a test that only executes a line leaves its mutants alive. Server and shared code only; the web
// project joins the scope when a plan exists for it. Mutation never runs in a git hook: only the `mutation` CI job runs it.
//
// `--logLevel debug` is never used: it crashes with Vitest 5 (Stryker issue 6272).

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  // The Vitest config selects the node `server` project only (Stryker forces coverage off and cannot drive jsdom).
  vitest: { configFile: 'vitest.stryker.config.ts' },
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.server.json',
  coverageAnalysis: 'perTest',
  mutate: [
    'src/server/**/*.ts',
    'src/shared/**/*.ts',
    '!src/**/*.test.ts',
    '!src/**/test-support.ts',
    '!src/**/global-setup.ts',
  ],
  // Never lowered (CLAUDE.md, Thresholds): a score below `break` fails the run.
  thresholds: { high: 95, low: 90, break: 90 },
  incremental: true,
  incrementalFile: 'reports/stryker-incremental.json',
  tempDirName: '.stryker-tmp',
  reporters: ['clear-text', 'html', 'json'],
  // The list of tests that ran per mutant is thousands of lines of log in CI; the survivors and the score are what matter.
  clearTextReporter: { logTests: false },
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
};
