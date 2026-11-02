// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import type { Env } from '../ci/lib/env.ts';
import type { Io } from '../ci/lib/io.ts';
import { BUDGET_VARIABLE, parse, type Request, STRYKER_SHARD, USAGE } from './mutate-args.ts';
import { SCRIPTS_SHARD } from './shards.ts';

// `yarn mutate` and `yarn mutate:shard` (E20-S04): run Stryker once per shard, each with its own incremental file and report.
// The shard comes from the first argument or from STRYKER_SHARD, never from a guess: a name that is not a shard is an error
// before anything runs. Everything else on the command line (--force, ...) goes to Stryker. A budget in minutes
// (MUTATE_BUDGET_MINUTES, set by the CI job) stops Stryker with SIGINT, on which Stryker writes the incremental results of
// the mutants it has finished, so a run that is too slow for its job keeps its work for the next run.

const STRYKER_SCOPE = 'STRYKER_SCOPE';

/** What one Stryker process did: its exit code, and whether the budget ended it. */
export interface Outcome {
  readonly code: number;
  readonly timedOut: boolean;
}

export interface MutateDeps {
  /** Runs `stryker <args>` with exactly this environment, its output going to ours; with a budget, sends SIGINT when it is spent. */
  readonly run: (args: readonly string[], env: Env, budgetMs: number | undefined) => Promise<Outcome>;
}

/** What every shard of one invocation shares. */
interface Context {
  readonly env: Env;
  readonly io: Io;
  readonly deps: MutateDeps;
}

/** The environment of one Stryker process: the caller's, with the scope and shard variables set for this shard only. */
function shardEnvironment(base: Env, shard: string): Env {
  const rest = Object.fromEntries(
    Object.entries(base).filter(([name]) => name !== STRYKER_SHARD && name !== STRYKER_SCOPE),
  );
  return shard === SCRIPTS_SHARD ? { ...rest, [STRYKER_SCOPE]: 'scripts' } : { ...rest, [STRYKER_SHARD]: shard };
}

/** One shard: Stryker with `--incremental` always, plus what the caller forwarded. */
async function runShard(shard: string, request: Request, run: Context): Promise<Outcome> {
  const { env, io, deps } = run;
  io.out(`mutation shard ${shard}: stryker run --incremental ${request.forward.join(' ')}`.trimEnd());
  const outcome = await deps.run(
    ['run', '--incremental', ...request.forward],
    shardEnvironment(env, shard),
    request.budgetMs,
  );
  if (outcome.timedOut) {
    io.err(
      `mutation shard ${shard}: stopped after the ${BUDGET_VARIABLE} budget; Stryker saves the results of the mutants it had finished (none are saved when it is stopped before the first result), and the next run continues from them`,
    );
  }
  io.out(`mutation shard ${shard}: exit code ${outcome.code}`);
  return outcome;
}

/** Exit code: 0 when every shard passed, 1 when one failed or was stopped by its budget (the others still run), 2 for usage. */
export async function runMutateCli(argv: readonly string[], env: Env, io: Io, deps: MutateDeps): Promise<number> {
  const parsed = parse(argv, env);
  if (!parsed.ok) {
    io.err(parsed.message);
    USAGE.forEach((line) => {
      io.err(line);
    });
    return 2;
  }
  const request = parsed.value;
  const failed: string[] = [];
  for (const shard of request.shards) {
    const outcome = await runShard(shard, request, { env, io, deps });
    if (outcome.code !== 0) {
      failed.push(shard);
    }
  }
  if (failed.length > 0) {
    io.err(`mutation: ${failed.length} of ${request.shards.length} shard(s) failed: ${failed.join(', ')}`);
  }
  return failed.length === 0 ? 0 : 1;
}
