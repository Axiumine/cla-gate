// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { randomBytes, randomInt } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { execWithTimeout, realExec } from '../ci/lib/exec.ts';
import { pickSystemFreePort } from '../ci/lib/ports.ts';
import type { SmokeCliDeps } from './cli.ts';
import type { StackDeps } from './stack-types.ts';

// E19-S08: the real dependencies of the container smoke test: docker on the PATH, crypto randomness, a bind probe on
// 127.0.0.1 for the ports, this checkout, and reports/smoke for the logs (git-ignored, uploaded by the workflow on a failure).

const ROOT = path.resolve(import.meta.dirname, '../..');

/** A cold `docker compose up --build` on a busy runner takes minutes; the job's timeout-minutes is the real limit. */
const COMMAND_TIMEOUT_MS = 600_000;

export const cliDeps: SmokeCliDeps = { exec: realExec };

export const stackDeps: StackDeps = {
  exec: execWithTimeout(COMMAND_TIMEOUT_MS),
  pickPort: pickSystemFreePort,
  randomInt: (min, max) => randomInt(min, max + 1),
  randomHex: (bytes) => randomBytes(bytes).toString('hex'),
  root: ROOT,
  env: process.env,
  logsDirectory: path.join(ROOT, 'reports', 'smoke'),
};
