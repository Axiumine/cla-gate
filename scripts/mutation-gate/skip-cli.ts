// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import { type Env, variable } from '../ci/lib/env.ts';
import type { Io } from '../ci/lib/io.ts';
import { printable } from '../code-caps/types.ts';
import { type Decision, decide, reasonOf } from './skip-decision.ts';
import type { Fetcher } from './skip-http.ts';

// `node scripts/mutation-gate/decide-skip.ts` (E20-S04, yarn mutate:decide): the step `decide` of the `mutation` job. It
// prints one line saying whether the leg of STRYKER_SHARD runs or is skipped and why, appends `skip=true` or `skip=false` to
// the file GITHUB_OUTPUT names, and for a skip adds a line to the job summary (GITHUB_STEP_SUMMARY). The exit code is 0
// whatever happened: a lookup that fails is a decision to run, and so is a shard name that is not a shard (the next step,
// `yarn mutate:shard`, rejects it loudly). It runs before `yarn install`, so it imports only Node and files of this
// repository that need no package.

export interface SkipDeps {
  readonly fetcher: Fetcher;
  readonly appendFile: (file: string, text: string) => void;
}

/** The decision, with every failure turned into a decision to run. */
async function decision(env: Env, fetcher: Fetcher): Promise<Decision> {
  try {
    return await decide(env, fetcher);
  } catch (error) {
    return { skip: false, message: `run, ${reasonOf(error)}` };
  }
}

/** Appends to a file Actions named (a variable that is unset or empty means a local run); false when the write failed. */
function append(deps: SkipDeps, file: string, text: string): boolean {
  if (file === '') {
    return true;
  }
  try {
    deps.appendFile(file, text);
    return true;
  } catch {
    return false;
  }
}

/** What a skip adds to the job summary: the commit and the run the decision relied on. */
function summaryOf(shard: string, found: { readonly runId: number; readonly sha: string }): string {
  return `Mutation shard \`${shard}\` skipped: commit \`${found.sha}\` already passed it in scheduled run ${found.runId}, a forced run.\n`;
}

/** Always 0: the lookup never fails the step. */
export async function runSkipCli(env: Env, io: Io, deps: SkipDeps): Promise<number> {
  const shard = printable(variable(env, 'STRYKER_SHARD'));
  const decided = await decision(env, deps.fetcher);
  io.out(`mutation skip check (${shard}): ${decided.message}`);
  if (decided.skip) {
    append(deps, variable(env, 'GITHUB_STEP_SUMMARY'), summaryOf(shard, decided));
  }
  if (!append(deps, variable(env, 'GITHUB_OUTPUT'), `skip=${decided.skip}\n`)) {
    io.err('mutation skip check: the GITHUB_OUTPUT file could not be written, so the later steps run');
  }
  return 0;
}
