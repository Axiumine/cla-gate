// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { spawn } from 'node:child_process';
import process from 'node:process';
import { pickSystemFreePort } from '../../ci/lib/ports.ts';
import { exitCodeOf } from './child-runner.ts';
import type { ServersDeps } from './dev-servers.ts';
import type { Child } from './dev-supervise.ts';

/** The signals that stop the dev servers: Ctrl-C and `kill`. */
const STOP_SIGNALS: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

/** Starts a command with `env` added to the environment and stdio inherited; `done` is 127 when it cannot start. */
export function spawnChild(command: string, args: readonly string[], env: Readonly<Record<string, string>>): Child {
  const child = spawn(command, [...args], { env: { ...process.env, ...env }, stdio: 'inherit' });
  const done = new Promise<number>((resolve) => {
    child.once('error', () => {
      resolve(127);
    });
    child.once('exit', (code, signal) => {
      resolve(exitCodeOf(code, signal));
    });
  });
  return {
    stop: (signal) => {
      child.kill(signal);
    },
    done,
  };
}

/** Calls `handler` with the signal on SIGINT and SIGTERM until the returned function removes the listeners again. */
export function onStopSignal(handler: (signal: NodeJS.Signals) => void): () => void {
  const listeners = STOP_SIGNALS.map(
    (signal) =>
      [
        signal,
        () => {
          handler(signal);
        },
      ] as const,
  );
  listeners.forEach(([signal, listener]) => {
    process.on(signal, listener);
  });
  return () => {
    listeners.forEach(([signal, listener]) => {
      process.off(signal, listener);
    });
  };
}

/** The real dependencies: bind probes on 127.0.0.1, child processes, process signals. */
export const systemServersDeps: ServersDeps = { pickPort: pickSystemFreePort, start: spawnChild, onStop: onStopSignal };
