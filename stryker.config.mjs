// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// The mutation gate (E20-S04, E20-S05): `yarn mutate` is `stryker run --incremental` once per shard. Mutation testing proves
// the 100% coverage gate is real, because a test that only executes a line leaves its mutants alive. Mutation never runs
// in a git hook: only the `mutation` CI job runs it.
//
// One cold run of all the server and shared mutants (4631 now, 3807 on 2026-11-02) does not fit a CI job on the shared
// runners (2026-11-02: the job was cancelled at its 45-minute timeout, and a run on main stopped at the initial test run).
// The maintainer decided to split the run by directory and not to mind the total time, so the scope is cut into shards
// (scripts/mutation-gate/shards.ts), each with its own incremental file, reports and score, and each one gated at `break`
// on its own.
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
import {
  incrementalFileOf,
  MUTATE_EXCLUSIONS,
  SCRIPTS_SHARD,
  serverShard,
  UNSHARDED_SERVER_GLOBS,
} from './scripts/mutation-gate/shards.ts';

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
  incrementalFile: incrementalFileOf(SCRIPTS_SHARD),
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
    incrementalFile: incrementalFileOf(shard.name),
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
    // The initial run executes the server project with per-test coverage, in one process (Stryker forces one worker), and
    // every shard repeats it: it runs the tests whose import graph reaches the shard's files, which for most shards is
    // nearly the whole project, so the whole project is the most any shard can need. Measured on 2026-11-03 for `shared`, cold,
    // `--concurrency 7`: 7003 tests in 12 min 37 s on the 32-core development machine at a load average of 5 to 12 (108 ms
    // per test; file start-up is 62 s of it, so the pool and isolation settings could save 8% at most, and 1117 tests that
    // each build the app over a fresh PGlite, about 0.5 s apiece, take 92%), and more than 20
    // minutes at a load average of 50 to 77 here and on the shared runner (the first scheduled run, also 2026-11-03:
    // "Initial test run timed out!" after exactly the 20 minutes this option had). The ceiling is a suite of 25 000
    // tests, of which the server project is about 80% (74% now): 20 000 tests x 108 ms = 36 minutes, times 3, the slowest
    // the shared runners are assumed to be (docs/quality-gates.md, Testing), = 108 minutes, and 120 leaves 11% on top. Today
    // that is 3.2 times the time the run needs on a runner (7003 x 108 ms x 3 = 38 minutes). The option only ends a run that
    // hangs; MUTATE_BUDGET_MINUTES and the job timeout (ci.yml) are kept 50 and 60 minutes above it, for the mutants.
    dryRunTimeoutMinutes: 120,
    reporters: ['clear-text', 'html', 'json'],
    // The list of tests that ran per mutant is thousands of lines of log in CI; the survivors and the score are what matter.
    clearTextReporter: { logTests: false },
    ...(scope === 'scripts'
      ? SCRIPTS_SCOPE
      : { ...SERVER_SCOPE, ...(shard === undefined ? {} : shardOptions(serverShard(shard))) }),
  };
}

export default strykerOptions(process.env['STRYKER_SCOPE'], process.env['STRYKER_SHARD']);
