// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// The shards of the mutation gate (E20-S04, E20-S05), defined here and nowhere else: stryker.config.mjs imports this module,
// scripts/mutation-gate/mutate.ts runs them, the `mutation` job of ci.yml lists them (a test compares the two), and the
// numbers in docs/quality-gates.md come from them.
//
// Why shards: one cold run of the server and shared code (19706 mutants on 2026-11-06, 3807 on 2026-11-02, before the webhook
// intake) does not fit one CI job on the shared runners. The maintainer decided on 2026-11-02 to split it by directory
// and not to mind the total time. A shard is a name and a list of mutate globs. Each shard has its own incremental file,
// reports and score, and each one must reach the `break` threshold on its own, so a strong directory cannot hide a weak one.
//
// Nothing may escape: shards.test.ts matches every file the unsharded server scope selects against these globs and fails
// unless each file lands in exactly one shard, so a new directory or a new file in a split directory is a failing test until
// it is assigned. A directory that is cut in two or more uses letter ranges and, for the last piece, their complement
// (`[a-n]*`, `o*` and `[!a-o]*`), so that every possible file name, a digit or a capital included, falls into exactly one piece by
// construction; a piece may instead be cut out by a negation (`shared`: everything but `cla-*`, which `shared-cla` has).

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
 * The server and shared code, by directory. A directory with more than about 1000 mutants is cut by file name: its glob keeps
 * the directory and adds a letter range, and the last piece of a directory takes the complement of the ranges before it, so that
 * a file name no range names (a digit, a capital) still has an owner. No shard may be expected to pass about 1500 mutants.
 *
 * The counts in the comments are what Stryker's own instrumenter makes of the files of the shard, which is the figure Stryker
 * prints before the initial test run ("Instrumented N source file(s) with M mutant(s)"), counted on the tree of 2026-11-06
 * (75683ea) without running a test: the static mutants and the ones the checker later drops as not compiling are in them, and
 * so is every file with no mutant (a file of types). They are not the numbers of a run: docs/quality-gates.md (Testing) says
 * which shard has been measured and which waits for its first nightly run.
 */
export const SERVER_SHARDS: readonly Shard[] = [
  // The shared code, but the CLA text code (`cla-*`, which `shared-cla` has). 43 files, 1055 mutants. Imported by nearly every test, so each
  // static mutant here runs most of the suite: the slowest shard per mutant.
  { name: 'shared', mutate: ['src/shared/**/*.ts', '!src/shared/cla-*.ts'] },
  // The CLA text code of E12: the Markdown pipeline (`cla-markdown*`), `cla-text`, `cla-version`, `cla-name`, `cla-history`. 11 files,
  // 774 mutants. It is cut out by a negation in `shared` and not by a letter range, so that a name no pattern foresaw is in `shared`.
  { name: 'shared-cla', mutate: ['src/shared/cla-*.ts'] },
  // 23 files, 776 mutants.
  { name: 'config', mutate: ['src/server/config/**/*.ts'] },
  // The HTTP adapter (115 files and 2829 mutants with the setup routes, the webhook intake and the public verification) is cut into
  // five by file name. The nightly run 42014893309 had it whole (`http-a-v`, 2664 mutants over 108 files at e9cc6bc): 31 minutes of
  // initial test run, and the budget stopped Stryker at 138.7 minutes with mutants left.
  // 36 files, 779 mutants.
  { name: 'http-a-d', mutate: ['src/server/adapters/http/[a-d]*.ts'] },
  // 17 files, 592 mutants.
  { name: 'http-e-o', mutate: ['src/server/adapters/http/[e-o]*.ts'] },
  // 26 files, 568 mutants.
  { name: 'http-p-r', mutate: ['src/server/adapters/http/[p-r]*.ts'] },
  // 28 files, 669 mutants.
  { name: 'http-s', mutate: ['src/server/adapters/http/s*.ts'] },
  // 20 files, 606 mutants: `t` to `z` (the webhook intake, `webhook-*`, is 385 of them) and any name that starts with a digit or a capital.
  { name: 'http-rest', mutate: ['src/server/adapters/http/[!a-s]*.ts'] },
  // 29 files, 660 mutants.
  { name: 'db', mutate: ['src/server/adapters/db/**/*.ts'] },
  // The files directly in src/server (app, boot, shutdown, main), the output encoding of the reporter (E09-S01, domain/reporting,
  // pure domain code) and the service ports. 43 files, 1069 mutants. The shard `root-domain-ports` was all of this and the
  // domain files below, 2487 mutants over 91 files: the dry run of the nightly run 42014893309 took 105 minutes.
  {
    name: 'root-reporting-ports',
    mutate: ['src/server/*.ts', 'src/server/domain/reporting/**/*.ts', 'src/server/services/ports/**/*.ts'],
  },
  // The domain files outside evaluation/ and reporting/, cut in two by file name. 21 files, 637 mutants.
  { name: 'domain-a-o', mutate: ['src/server/domain/[a-o]*.ts'] },
  // 27 files, 781 mutants.
  { name: 'domain-rest', mutate: ['src/server/domain/[!a-o]*.ts'] },
  // The GitHub adapter, cut in three by file name. `github-a-o` (881 mutants, 31 files) had a dry run of 70 minutes in the nightly run
  // 42014893309 and needed about 111 minutes for its mutants, with 99 left in the budget. 349 mutants, 12 files.
  { name: 'github-a-n', mutate: ['src/server/adapters/github/[a-n]*.ts'] },
  // 19 files, 532 mutants (`octokit-*`, the wrappers of the Octokit calls).
  { name: 'github-o', mutate: ['src/server/adapters/github/o*.ts'] },
  // 18 files, 675 mutants.
  { name: 'github-rest', mutate: ['src/server/adapters/github/[!a-o]*.ts'] },
  // 15 files (5 of them hold only types and have no mutant), 382 mutants.
  { name: 'evaluation-a-l', mutate: ['src/server/domain/evaluation/[a-l]*.ts'] },
  // 10 files, 471 mutants.
  { name: 'evaluation-rest', mutate: ['src/server/domain/evaluation/[!a-l]*.ts'] },
  // 16 files, 525 mutants: every service whose name starts with `i` (installation-*).
  { name: 'services-installation', mutate: ['src/server/services/i*.ts'] },
  // The services directly in services/ are cut by file name into six (`i*` is `services-installation`; the directories below services/
  // belong to the shards that name them, and to `services-other` for `export/`). The shard `services-other` was `[!i]*` and `export/`
  // whole: 4953 mutants over 176 files (4586 over 168 at e9cc6bc), with a dry run of 76 minutes in the nightly run 42014893309 and the
  // budget stopping Stryker after 93.4 minutes of mutants.
  // 19 files, 642 mutants.
  { name: 'services-a', mutate: ['src/server/services/a*.ts'] },
  // 26 files, 722 mutants: `cla-*` (the CLA document code of E12), the other names that start with `b`, `c` but not `co`, or `d`.
  { name: 'services-b-d', mutate: ['src/server/services/[bd]*.ts', 'src/server/services/c[!o]*.ts'] },
  // 41 files, 1314 mutants: `commit-override-*` (E15) and `corporate-*` (E21). The corporate code (31 files, 1133 mutants) took the shard
  // above, then `[b-d]*`, to 2036 mutants, so the names that start with `co` are a shard of their own.
  { name: 'services-co', mutate: ['src/server/services/co*.ts'] },
  // 36 files, 1067 mutants.
  { name: 'services-e-q', mutate: ['src/server/services/[e-hj-q]*.ts'] },
  // 40 files, 1024 mutants.
  { name: 'services-r', mutate: ['src/server/services/r*.ts'] },
  // 28 files, 754 mutants.
  { name: 'services-s', mutate: ['src/server/services/s*.ts'] },
  // 584 mutants: the services from `t` to `z` (7 files, 244 mutants), a name with a digit or a capital first, and the export code
  // (E16-S03 and E16-S06, `services/export/`: 11 files, 340 mutants).
  { name: 'services-other', mutate: ['src/server/services/[!a-s]*.ts', 'src/server/services/export/**/*.ts'] },
  // The job queue and its workers (E07): pg-boss runtime, producer, queue policy, serialisation, workers and the sweep schedule.
  // 17 files, 532 mutants.
  { name: 'jobs-adapter', mutate: ['src/server/adapters/jobs/**/*.ts'] },
  // The evaluate-pr job (E07-S04): the pull request and commit reads, the policy facts and the evaluation protocol. The Check Run
  // reporter it calls (E09-S05, services/reporting) joins it: it is the other half of that job's protocol. 30 files, 1068 mutants.
  { name: 'evaluate-pr', mutate: ['src/server/services/evaluate-pr/**/*.ts', 'src/server/services/reporting/**/*.ts'] },
  // The job handlers of E07-S05 to S07, E14-S04 and E22-S01: the dead-letter handler, the close-pr job, the finalise jobs that follow
  // turning enforcement off, /recheck and Re-run, and the evaluation of a merge queue's group (its rows, member discovery and job).
  // 29 files, 805 mutants.
  {
    name: 'job-handlers',
    mutate: [
      'src/server/services/close-pr/**/*.ts',
      'src/server/services/dead-letter/**/*.ts',
      'src/server/services/finalise/**/*.ts',
      'src/server/services/merge-group/**/*.ts',
      'src/server/services/recheck/**/*.ts',
    ],
  },
  // The scheduled reconciliation sweep (E07-S08) and the retention sweep of operational data (E22-S04). 16 files, 448 mutants.
  { name: 'sweep', mutate: ['src/server/services/sweep/**/*.ts', 'src/server/services/retention/**/*.ts'] },
];

/** The scripts scope (E20-S05, the caps tool) is a shard of its own, selected by STRYKER_SCOPE=scripts and not by STRYKER_SHARD. */
export const SCRIPTS_SHARD = 'scripts';

/** Every shard of the gate in the order `yarn mutate` runs them, the scripts scope last. */
export const SHARD_NAMES: readonly string[] = [...SERVER_SHARDS.map((shard) => shard.name), SCRIPTS_SHARD];

/** The incremental file of a shard (the name of a server shard or `scripts`), relative to the repository root; the CI cache path. */
export function incrementalFileOf(shard: string): string {
  return `reports/stryker-incremental-${shard}.json`;
}

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
