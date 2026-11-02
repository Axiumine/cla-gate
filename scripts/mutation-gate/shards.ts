// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// The shards of the mutation gate (E20-S04, E20-S05), defined here and nowhere else: stryker.config.mjs imports this module,
// scripts/mutation-gate/mutate.ts runs them, the `mutation` job of ci.yml lists them (a test compares the two), and the
// numbers in docs/quality-gates.md come from them.
//
// Why shards: one cold run of the server and shared code (3807 mutants) does not fit one CI job on the shared runners.
// The maintainer decided on 2026-11-02 to split it by directory and not to mind the total time. A shard is a name and a
// list of mutate globs. Each shard has its own incremental file, reports and score, and each one must reach the `break`
// threshold on its own, so a strong directory cannot hide a weak one.
//
// Nothing may escape: shards.test.ts matches every file the unsharded server scope selects against these globs and fails
// unless each file lands in exactly one shard, so a new directory or a new file in a split directory is a failing test until
// it is assigned. A directory that is cut in two uses a letter range and its complement (`[a-o]*` and `[!a-o]*`, `i*` and
// `[!i]*`), so that every possible file name, a digit or a capital included, falls into exactly one half by construction.

export interface Shard {
  /** Lower case words joined with `-`; it names the incremental file, the report directory, the cache and the CI artifact. */
  readonly name: string;
  readonly mutate: readonly string[];
}

/** What the server scope mutates when no shard is chosen: every file under these two directories, minus the exclusions. */
export const UNSHARDED_SERVER_GLOBS: readonly string[] = ['src/server/**/*.ts', 'src/shared/**/*.ts'];

/** Files that are not production code: tests, test-support modules and the Vitest global setup. */
export const MUTATE_EXCLUSIONS: readonly string[] = [
  '!src/**/*.test.ts',
  '!src/**/test-support.ts',
  '!src/**/global-setup.ts',
];

/**
 * The server and shared code, by directory. A directory with more than about 500 mutants is cut by file name: its glob
 * keeps the directory and adds a letter range. The counts are what Stryker prints before the initial test run
 * ("Instrumented N source file(s) with M mutant(s)"), measured on 2026-11-02, and docs/quality-gates.md (Testing) has the
 * table with the times.
 */
export const SERVER_SHARDS: readonly Shard[] = [
  // 8 files, 161 mutants. Imported by nearly every test, so each static mutant here runs most of the suite: the slowest
  // shard per mutant.
  { name: 'shared', mutate: ['src/shared/**/*.ts'] },
  // 8 files, 367 mutants.
  { name: 'config', mutate: ['src/server/config/**/*.ts'] },
  // 9 files, 362 mutants.
  { name: 'http', mutate: ['src/server/adapters/http/**/*.ts'] },
  // 14 files, 215 mutants.
  { name: 'db', mutate: ['src/server/adapters/db/**/*.ts'] },
  // 9 + 3 + 4 files, 111 + 112 + 27 mutants (250 in all): the files directly in src/server (app, boot, shutdown, main), the domain files
  // outside evaluation/ and the service ports.
  {
    name: 'root-domain-ports',
    mutate: ['src/server/*.ts', 'src/server/domain/*.ts', 'src/server/services/ports/**/*.ts'],
  },
  // 19 files, 496 mutants.
  { name: 'github-a-o', mutate: ['src/server/adapters/github/[a-o]*.ts'] },
  // 13 files, 383 mutants.
  { name: 'github-rest', mutate: ['src/server/adapters/github/[!a-o]*.ts'] },
  // 15 files (5 of them hold only types and have no mutant), 382 mutants.
  { name: 'evaluation-a-l', mutate: ['src/server/domain/evaluation/[a-l]*.ts'] },
  // 10 files, 441 mutants.
  { name: 'evaluation-rest', mutate: ['src/server/domain/evaluation/[!a-l]*.ts'] },
  // 14 files, 419 mutants: every service whose name starts with `i` (installation-*).
  { name: 'services-installation', mutate: ['src/server/services/i*.ts'] },
  // 12 files, 331 mutants: every other service (audit-*, repository-*, admission-policies).
  { name: 'services-other', mutate: ['src/server/services/[!i]*.ts'] },
];

/** The scripts scope (E20-S05, the caps tool) is a shard of its own, selected by STRYKER_SCOPE=scripts and not by STRYKER_SHARD. */
export const SCRIPTS_SHARD = 'scripts';

/** Every shard of the gate in the order `yarn mutate` runs them, the scripts scope last. */
export const SHARD_NAMES: readonly string[] = [...SERVER_SHARDS.map((shard) => shard.name), SCRIPTS_SHARD];

/** The server shard with this name, or an error that lists the valid ones (the scripts scope is not a server shard). */
export function serverShard(name: string): Shard {
  const found = SERVER_SHARDS.find((shard) => shard.name === name);
  if (found === undefined) {
    throw new Error(
      `STRYKER_SHARD must be unset or one of ${SERVER_SHARDS.map((shard) => shard.name).join(', ')}, not ${JSON.stringify(name)}`,
    );
  }
  return found;
}
