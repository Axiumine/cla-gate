// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import process from 'node:process';
import type { Kysely } from 'kysely';
import { ConfigError } from '../../config/config-error.ts';
import { loadConfig } from '../../config/env.ts';
import { type Clock, systemClock } from '../../services/ports/clock.ts';
import { type RetentionCounts, runRetentionSweep } from '../../services/retention/retention-sweep.ts';
import { createPgDatabase } from './pg.ts';
import type { Database } from './schema.ts';

// `node src/server/retention.ts [--dry-run]` (E22-S04): the retention sweep by hand, for an operator who does not want to wait for
// the daily job, or who wants to see what it would delete. It runs the code of the scheduled job (`runRetentionSweep`) with the
// settings of the server's own environment, as the runtime role of `DATABASE_URL`, which holds the DELETE the sweep needs and
// nothing more. A dry run prints the counts and deletes nothing. It prints numbers and names of tables, never a row.

/** What the command prints when it is called wrongly. */
const USAGE = 'usage: node src/server/retention.ts [--dry-run]';

export interface RetentionCliOptions {
  /** The arguments after the script name. */
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly out?: (line: string) => void;
  readonly err?: (line: string) => void;
  /** Defaults to node-postgres. Tests pass PGlite. */
  readonly connect?: (connectionString: string, onError: (error: Error) => void) => Kysely<Database>;
  /** Defaults to the wall clock. */
  readonly clock?: Clock;
}

/** `true` for a dry run, `false` for a real one, `undefined` for arguments the command does not take. */
function dryRunOf(argv: readonly string[]): boolean | undefined {
  if (argv.length === 0) {
    return false;
  }
  return argv.length === 1 && argv[0] === '--dry-run' ? true : undefined;
}

/** The SQLSTATE or system code of a failure, when it has one that is plain: the message of a database error can quote a row. */
function codeOf(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  return typeof code === 'string' && /^\w{1,32}$/.test(code) ? ` (${code})` : '';
}

/** What a failed run prints: one line per invalid variable, or the name and the code of the error, never its message. */
function failureLines(error: unknown): string[] {
  if (error instanceof ConfigError) {
    return error.lines.map((line) => `retention failed: ${line}`);
  }
  return [`retention failed: ${error instanceof Error ? error.name : 'unknown error'}${codeOf(error)}`];
}

/** The line a finished run prints: the two counts and what they mean. */
function summaryLine(counts: RetentionCounts, dryRun: boolean): string {
  const rows = `${counts.webhook_deliveries} webhook_deliveries and ${counts.sessions} sessions`;
  return dryRun ? `retention dry run: ${rows} would be deleted; nothing was deleted` : `retention: deleted ${rows}`;
}

/**
 * Runs the command and returns the process exit code: 0 when the sweep ran, 1 when the configuration is invalid or the sweep
 * failed (what committed before the failure stays committed; running again continues), 2 for arguments it does not take.
 */
export async function runRetentionCli(options: RetentionCliOptions): Promise<number> {
  const out = options.out ?? ((line: string) => process.stdout.write(`${line}\n`));
  const err = options.err ?? ((line: string) => process.stderr.write(`${line}\n`));
  const dryRun = dryRunOf(options.argv);
  if (dryRun === undefined) {
    err(USAGE);
    return 2;
  }
  try {
    const config = loadConfig(options.env);
    const connect = options.connect ?? ((connectionString, onError) => createPgDatabase({ connectionString, onError }));
    const db = connect(config.databaseUrl.reveal(), (error) => {
      err(`retention: database error${codeOf(error)}`);
    });
    try {
      const clock = options.clock ?? systemClock;
      out(summaryLine(await runRetentionSweep({ db, clock, settings: config.retention }, { dryRun }), dryRun));
    } finally {
      await db.destroy();
    }
    return 0;
  } catch (error) {
    for (const line of failureLines(error)) {
      err(line);
    }
    return 1;
  }
}
