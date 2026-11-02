// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { printable } from '../code-caps/types.ts';
import type { LeakDeps } from './deps.ts';
import { guardExit } from './exit-guard.ts';
import { ORIGIN_VARIABLE } from './fixture-url.ts';
import { EXIT_ERROR, exitCodeOf, reportLines, type ScenarioOutcome } from './outcome.ts';
import { scenarioFiles } from './scenario.ts';
import { messageOf, runScenario } from './scenario-run.ts';

// E20-S07: the wrapper around @memlab/api, which decides the exit code from the outcome of every scenario.

/** Runs the scenarios one after the other (one browser at a time), printing each result as soon as it is known. */
async function runAll(files: readonly string[], deps: LeakDeps): Promise<ScenarioOutcome[]> {
  const server = await deps.serve(deps.places.fixtures);
  Reflect.set(deps.env, ORIGIN_VARIABLE, server.origin);
  const outcomes: ScenarioOutcome[] = [];
  try {
    for (const file of files) {
      const outcome = await runScenario(file, deps);
      const print = outcome.status === 'failed' ? deps.io.err : deps.io.out;
      reportLines(outcome).forEach((line) => {
        print(line);
      });
      outcomes.push(outcome);
    }
  } finally {
    await server.close();
  }
  return outcomes;
}

async function runChecked(args: readonly string[], deps: LeakDeps): Promise<number> {
  const places = { cwd: deps.cwd, directory: deps.places.scenarios };
  const files = scenarioFiles(args, places, deps.files.list);
  if (files.length === 0) {
    deps.io.err(`leaks: no scenario to run in ${printable(deps.places.scenarios)}: a run of nothing is not a pass`);
    return EXIT_ERROR;
  }
  const outcomes = await runAll(files, deps);
  const code = exitCodeOf(outcomes);
  const leaked = outcomes.filter((outcome) => outcome.status === 'finished' && outcome.leaks > 0).length;
  const failed = outcomes.filter((outcome) => outcome.status === 'failed').length;
  deps.io.out(`leaks: ${outcomes.length} scenario(s), ${leaked} leaked, ${failed} failed: exit code ${code}`);
  return code;
}

/**
 * Runs the scenarios named in `args` (all of `places.scenarios` when there are none) and returns the exit code: 0 when none
 * leaked, 1 when one did, 2 on any error, including an exit memlab forces before the end. The caller sets `process.exitCode`.
 */
export async function runLeaks(args: readonly string[], deps: LeakDeps): Promise<number> {
  const finish = guardExit(deps.process, deps.io);
  try {
    return await runChecked(args, deps);
  } catch (error) {
    deps.io.err(`leaks: ${printable(messageOf(error))}`);
    return EXIT_ERROR;
  } finally {
    finish();
  }
}
