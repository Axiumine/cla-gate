// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../../shared/github-id.ts';
import { ERASE_USAGE, parseEraseArguments } from '../../domain/erase-arguments.ts';
import { type ErasureOutcome, exitCodeOf } from '../../domain/operator-erasure.ts';
import { dryRunLines, erasedLines, mismatchLines, partialLine } from '../../domain/operator-erasure-lines.ts';
import { runOperatorErasure } from '../../services/operator-erasure.ts';
import { type CliOptions, failureLines, printLines, sinksOf, withDatabase } from './cli-database.ts';

// `node src/server/erase.ts --github-id <n> --actor-github-id <n> [--execute]` (E22-S05): a safe command-line wrapper around the
// audited SQL function `erase_signer_pii` (E16-S04), for a server operator who receives an erasure request. It is a dry run
// unless `--execute` is given. It connects as the runtime role of `DATABASE_URL`, which can read the tables it counts and execute
// the function and has no DELETE or UPDATE on `signer_pii`, so the function is the only way it can erase anything. It prints
// counts and numeric ids and fixed words, never a row: no name, login or email is ever read into the program.

/** What the command prints for an id the server has never seen. */
const UNKNOWN_ID_LINE = 'no such user';

/** What the command prints for a person who has nothing left to erase. */
const NOTHING_TO_ERASE = 'nothing to erase';

/** The lines an outcome prints, on standard output and on standard error. */
function reportOf(githubId: GithubId, outcome: ErasureOutcome): { readonly out: string[]; readonly err: string[] } {
  switch (outcome.kind) {
    case 'unknown':
      return { out: [], err: [UNKNOWN_ID_LINE] };
    case 'nothing':
      return { out: [NOTHING_TO_ERASE], err: [] };
    case 'dry_run':
      return { out: dryRunLines(githubId, outcome.before), err: [] };
    case 'erased':
      return { out: erasedLines(githubId, outcome.before, outcome.erased), err: [] };
    case 'mismatch':
      return { out: [], err: mismatchLines(githubId, outcome.before, outcome.after) };
    case 'failed':
      return { out: [], err: [...failureLines('erase', outcome.cause), partialLine(outcome.done, outcome.pending)] };
  }
}

/**
 * Runs the command and returns the process exit code: 0 for a dry run, an erasure that held, or a person with nothing to erase;
 * 1 for a GitHub id the server has never seen, an invalid configuration, or a failure before anything was changed; 2 for
 * arguments it does not take; 3 when the check after the erasure found a mismatch; 4 when a call failed part-way (what finished
 * stays finished; running again is safe).
 */
export async function runEraseCli(options: CliOptions): Promise<number> {
  const { out, err } = sinksOf(options);
  const request = parseEraseArguments(options.argv);
  if (request === undefined) {
    err(ERASE_USAGE);
    return 2;
  }
  try {
    return await withDatabase('erase', { ...options, err }, async (db) => {
      const outcome = await runOperatorErasure(db, request);
      const report = reportOf(request.githubId, outcome);
      printLines(out, report.out);
      printLines(err, report.err);
      return exitCodeOf(outcome);
    });
  } catch (error) {
    printLines(err, failureLines('erase', error));
    return 1;
  }
}
