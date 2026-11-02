// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import process from 'node:process';
import { type AppConfig, loadConfig } from './config/env.ts';
import type { ProcessLike } from './shutdown.ts';

function writeStderr(line: string): void {
  process.stderr.write(`${line}\n`);
}

/**
 * Loads the configuration from `env`. An invalid one is reported through `err` (stderr by default), sets the exit code to
 * 1 and ends in undefined; nothing has been opened by then.
 */
export function loadConfigOrReport(options: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly signals: ProcessLike;
  readonly err?: ((line: string) => void) | undefined;
}): AppConfig | undefined {
  try {
    return loadConfig(options.env);
  } catch (error) {
    (options.err ?? writeStderr)(String(error));
    options.signals.exitCode = 1;
    return undefined;
  }
}
