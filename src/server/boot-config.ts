// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import process from 'node:process';
import { ConfigError } from './config/config-error.ts';
import { type AppConfig, loadConfig } from './config/env.ts';
import type { ProcessLike } from './shutdown.ts';

/** Where start-up failures go when nothing else is given: one line of plain text on stderr, before any logger exists. */
export function writeStderr(line: string): void {
  process.stderr.write(`${line}\n`);
}

/**
 * Loads the configuration from `env`. An invalid one is reported through `err` (stderr by default), one line per invalid
 * variable (`VARIABLE: rule`, E19-S02), sets the exit code to 1 and ends in undefined; nothing has been opened by then.
 */
export function loadConfigOrReport(options: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly signals: ProcessLike;
  readonly err?: ((line: string) => void) | undefined;
}): AppConfig | undefined {
  try {
    return loadConfig(options.env);
  } catch (error) {
    if (!(error instanceof ConfigError)) {
      throw error;
    }
    for (const line of error.lines) {
      (options.err ?? writeStderr)(line);
    }
    options.signals.exitCode = 1;
    return undefined;
  }
}
