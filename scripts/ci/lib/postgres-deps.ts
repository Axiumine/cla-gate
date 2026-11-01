// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { realExec } from './exec.ts';
import { pickSystemFreePort } from './ports.ts';
import type { StartDeps } from './postgres-container.ts';

export interface CliDeps extends StartDeps {
  readonly randomHex: (bytes: number) => string;
  readonly appendFile: (file: string, text: string) => void;
}

/** The real dependencies: docker on PATH, crypto randomness, a bind probe on 127.0.0.1, the wall clock. */
export const systemDeps: CliDeps = {
  exec: realExec,
  pickPort: pickSystemFreePort,
  sleep: (ms) => delay(ms),
  now: () => Date.now(),
  randomHex: (bytes) => randomBytes(bytes).toString('hex'),
  appendFile: (file, text) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is GITHUB_ENV, set by the Actions runner
    fs.appendFileSync(file, text);
  },
};
