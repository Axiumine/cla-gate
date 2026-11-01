// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type ChildProcess, spawn } from 'node:child_process';
import os from 'node:os';
import process from 'node:process';

/** Signals to hand on to the child, so Ctrl-C and `kill` reach `node --watch` and not only this wrapper. */
const FORWARDED: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

/** Exit code of a finished child: its own, or 128 plus the signal number that ended it. */
export function exitCodeOf(code: number | null, signal: NodeJS.Signals | null): number {
  if (code !== null) {
    return code;
  }
  // eslint-disable-next-line security/detect-object-injection -- `signal` is the closed NodeJS.Signals union, os.constants.signals has every member
  return signal === null ? 1 : 128 + os.constants.signals[signal];
}

/** Runs a command with `env` added to the environment, stdio inherited; resolves with its exit code (127 when it cannot start). */
export function runChild(
  command: string,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
): Promise<number> {
  return new Promise((resolve) => {
    const child: ChildProcess = spawn(command, [...args], { env: { ...process.env, ...env }, stdio: 'inherit' });
    const handlers = FORWARDED.map((signal) => {
      const handler = () => child.kill(signal);
      process.on(signal, handler);
      return () => process.off(signal, handler);
    });
    const done = (code: number) => {
      handlers.forEach((remove) => {
        remove();
      });
      resolve(code);
    };
    child.once('error', () => {
      done(127);
    });
    child.once('exit', (code, signal) => {
      done(exitCodeOf(code, signal));
    });
  });
}
