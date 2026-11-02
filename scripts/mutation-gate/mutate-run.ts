// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import type { Env } from '../ci/lib/env.ts';
import type { MutateDeps, Outcome } from './mutate-cli.ts';

// The one place that starts a process for the mutation gate: Stryker's own entry point under the Node that runs this script
// (no shell, no `yarn` in between, so a signal reaches Stryker itself and not a wrapper that would die before it saved).

const ROOT = path.resolve(import.meta.dirname, '../..');
const STRYKER = path.join(ROOT, 'node_modules/@stryker-mutator/core/bin/stryker.js');
const NOT_FOUND = 127;

/**
 * Runs `file args` in the repository root with exactly `env`, output inherited, and resolves when it has exited. With a
 * budget the child gets SIGINT when it is spent and is then waited for: a process that handles SIGINT (Stryker writes its
 * incremental file) finishes what it was doing. Never rejects: a binary that cannot start is exit code 127.
 */
export function runChild(
  file: string,
  args: readonly string[],
  env: Env,
  budgetMs: number | undefined,
): Promise<Outcome> {
  return new Promise((resolve) => {
    const budget = budgetMs === undefined ? undefined : AbortSignal.timeout(budgetMs);
    const options = { cwd: ROOT, env: { ...env }, stdio: 'inherit' } as const;
    const child =
      budget === undefined
        ? spawn(file, [...args], options)
        : spawn(file, [...args], { ...options, signal: budget, killSignal: 'SIGINT' });
    // An abort is reported as an 'error' event too; only a failure to start matters, and then there is no 'close'.
    child.on('error', (error) => {
      if (child.pid === undefined) {
        process.stderr.write(`cannot start ${file}: ${error.message}\n`);
        resolve({ code: NOT_FOUND, timedOut: false });
      }
    });
    // The code is null when a signal ended the child; 1 then, like scripts/ci/lib/exec.ts.
    child.on('close', (code) => {
      resolve({ code: code ?? 1, timedOut: budget?.aborted === true });
    });
  });
}

export const systemDeps: MutateDeps = {
  run: (args, env, budgetMs) => runChild(process.execPath, [STRYKER, ...args], env, budgetMs),
};
