// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// The mutation gate (E20-S04, E20-S05): `yarn mutate` is `stryker run --incremental` once per shard. Mutation testing proves
// the 100% coverage gate is real, because a test that only executes a line leaves its mutants alive. Mutation never runs
// in a git hook: only the `mutation` CI job runs it.
//
// One cold run of all 3807 server and shared mutants does not fit a CI job on the shared runners (2026-11-02: the job was
// cancelled at its 45-minute timeout, and a run on main stopped at the initial test run). The maintainer decided to split
// the run by directory and not to mind the total time, so the scope is cut into shards (scripts/mutation-gate/shards.ts),
// each with its own incremental file, reports and score, and each one gated at `break` on its own.
//
// Two environment variables choose what runs:
//   STRYKER_SCOPE   unset (or `server`)  server and shared code (E20-S04).
//                   `scripts`            the code caps tool, a gate in itself (E20-S05): `yarn mutate:scripts`.
//   STRYKER_SHARD   a server shard name   only that shard's files, with its own cache and report names: `yarn mutate:shard`.
//                   unset                 the whole server scope in one run, as before the split. That is for a one-off local
//                                         run and for tools that load this file (Knip, an editor); CI and `yarn mutate` always
//                                         name a shard. It is not an error because an error here would break those tools, and
//                                         the result cannot mislead: it covers every file, only slowly.
// Any other value, an empty one included, throws, and so does STRYKER_SHARD together with STRYKER_SCOPE=scripts: a typo
// must never run the wrong files and pass.
//
// `--logLevel debug` is never used: it crashes with Vitest 5 (Stryker issue 6272).

import process from 'node:process';
import { MUTATE_EXCLUSIONS, serverShard, UNSHARDED_SERVER_GLOBS } from './scripts/mutation-gate/shards.ts';

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const SERVER_SCOPE = {
  // The Vitest config selects the node `server` project only (Stryker forces coverage off and cannot drive jsdom).
  // `related` is the default (true), written down because the shards rely on it: the initial run and every mutant run
  // execute only the tests whose import graph reaches the mutated files, so a shard's initial run is narrower than the
  // whole suite. A test that reaches a file only through a dynamic path is missed; its mutants then count as not covered,
  // which lowers the score and never hides a survivor.
  vitest: { configFile: 'vitest.stryker.config.ts', related: true },
  tsconfigFile: 'tsconfig.server.json',
  mutate: [...UNSHARDED_SERVER_GLOBS, ...MUTATE_EXCLUSIONS],
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
  // Under reports/mutation/<shard>/ so that each shard's artifact holds its own reports and no run overwrites another's.
  htmlReporter: { fileName: 'reports/mutation/scripts/index.html' },
  jsonReporter: { fileName: 'reports/mutation/scripts/mutation.json' },
};

/**
 * The options of one server shard: its files and the file names that carry its name.
 * @param {import('./scripts/mutation-gate/shards.ts').Shard} shard
 * @returns {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
function shardOptions(shard) {
  return {
    mutate: [...shard.mutate, ...MUTATE_EXCLUSIONS],
    incrementalFile: `reports/stryker-incremental-${shard.name}.json`,
    htmlReporter: { fileName: `reports/mutation/${shard.name}/index.html` },
    jsonReporter: { fileName: `reports/mutation/${shard.name}/mutation.json` },
  };
}

/**
 * The options of one scope and shard; `undefined` is the server scope and the whole of it. Exported for the tests, which
 * cannot read the default export for a scope other than the one the environment of the current run selects.
 * @param {string | undefined} scope
 * @param {string | undefined} [shard]
 * @returns {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
export function strykerOptions(scope, shard) {
  if (scope !== undefined && scope !== 'server' && scope !== 'scripts') {
    throw new Error(`STRYKER_SCOPE must be unset, "server" or "scripts", not ${JSON.stringify(scope)}`);
  }
  if (scope === 'scripts' && shard !== undefined) {
    throw new Error('STRYKER_SHARD names a server shard and cannot be combined with STRYKER_SCOPE=scripts');
  }
  return {
    testRunner: 'vitest',
    checkers: ['typescript'],
    coverageAnalysis: 'perTest',
    // Never lowered (E20-S04): a score below `break` fails the run.
    thresholds: { high: 95, low: 90, break: 90 },
    incremental: true,
    tempDirName: '.stryker-tmp',
    // The initial run executes the server project with per-test coverage: 2790 tests took 2 minutes 37 seconds on a
    // 32-core development machine and, on the shared 8-core runner, more than Stryker's default of 5 minutes (a run on main
    // stopped there on 2026-11-02, "Initial test run timed out!"). 20 minutes is about 7 times the measured time of the
    // whole suite, which is the most any shard can need because `related` only narrows it, and still ends a hung run
    // long before the job timeout.
    dryRunTimeoutMinutes: 20,
    reporters: ['clear-text', 'html', 'json'],
    // The list of tests that ran per mutant is thousands of lines of log in CI; the survivors and the score are what matter.
    clearTextReporter: { logTests: false },
    ...(scope === 'scripts'
      ? SCRIPTS_SCOPE
      : { ...SERVER_SCOPE, ...(shard === undefined ? {} : shardOptions(serverShard(shard))) }),
  };
}

export default strykerOptions(process.env['STRYKER_SCOPE'], process.env['STRYKER_SHARD']);
