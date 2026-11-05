// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Clock, systemClock } from '../../services/ports/clock.ts';
import { type RetentionCounts, runRetentionSweep } from '../../services/retention/retention-sweep.ts';
import { type CliOptions, failureLines, printLines, sinksOf, withDatabase } from './cli-database.ts';

// `node src/server/retention.ts [--dry-run]` (E22-S04): the retention sweep by hand, for an operator who does not want to wait for
// the daily job, or who wants to see what it would delete. It runs the code of the scheduled job (`runRetentionSweep`) with the
// settings of the server's own environment, as the runtime role of `DATABASE_URL`, which holds the DELETE the sweep needs and
// nothing more. A dry run prints the counts and deletes nothing. It prints numbers and names of tables, never a row.

/** What the command prints when it is called wrongly. */
const USAGE = 'usage: node src/server/retention.ts [--dry-run]';

export interface RetentionCliOptions extends CliOptions {
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
  const { out, err } = sinksOf(options);
  const dryRun = dryRunOf(options.argv);
  if (dryRun === undefined) {
    err(USAGE);
    return 2;
  }
  try {
    await withDatabase('retention', { ...options, err }, async (db, config) => {
      const clock = options.clock ?? systemClock;
      out(summaryLine(await runRetentionSweep({ db, clock, settings: config.retention }, { dryRun }), dryRun));
    });
    return 0;
  } catch (error) {
    printLines(err, failureLines('retention', error));
    return 1;
  }
}
