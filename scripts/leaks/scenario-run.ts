// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import type { LeakDeps } from './deps.ts';
import { type ScenarioOutcome, traceSteps } from './outcome.ts';
import { scenarioName, scenarioOf } from './scenario.ts';

// E20-S07: one scenario through memlab, whatever happens: the result is an outcome, never an exception.

/** memlab rejects with an `Error`, but its halting path throws the string `unreachable`: anything becomes a message. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runScenario(file: string, deps: LeakDeps): Promise<ScenarioOutcome> {
  const name = scenarioName(file);
  deps.io.out(`scenario ${name}: running`);
  try {
    const scenario = scenarioOf(await deps.load(file), file);
    const directory = path.join(deps.places.report, name);
    const workDir = path.join(directory, 'memlab');
    deps.files.makeDirectory(workDir);
    const { leaks } = await deps.memlab({ scenario, workDir, chromiumBinary: deps.chromiumBinary, skipWarmup: true });
    deps.files.write(path.join(directory, 'leaks.json'), `${JSON.stringify(leaks, null, 2)}\n`);
    return { status: 'finished', name, leaks: leaks.length, traces: leaks.map(traceSteps) };
  } catch (error) {
    return { status: 'failed', name, message: messageOf(error) };
  }
}
