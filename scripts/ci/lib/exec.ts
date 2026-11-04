// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { execFile } from 'node:child_process';
import process from 'node:process';

export interface ExecResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs `file` with `args` (never through a shell) and resolves with the outcome; it does not reject on a non-zero exit.
 * `env` is added to the environment of the child only, which is how a secret reaches `docker run -e NAME` without
 * appearing in the process list.
 */
export type Exec = (
  file: string,
  args: readonly string[],
  env?: Readonly<Record<string, string>>,
) => Promise<ExecResult>;

/** Docker can pull an image here, so the bound is generous; the job's timeout-minutes is the real limit. */
const EXEC_TIMEOUT_MS = 300_000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const NOT_FOUND = 127;

/** Exit code of a failed child: its own code, 127 when the binary is missing, 1 for a signal or anything else. */
function exitCode(code: string | number | null | undefined): number {
  if (typeof code === 'number') {
    return code;
  }
  return code === 'ENOENT' ? NOT_FOUND : 1;
}

/**
 * An {@link Exec} that stops a child after `timeoutMs`. The default one gives five minutes; the container smoke test (E19-S08)
 * builds an image inside one `docker compose up`, which takes longer on a cold runner.
 */
export function execWithTimeout(timeoutMs: number): Exec {
  return (file, args, env = {}) =>
    new Promise((resolve) => {
      const options = { env: { ...process.env, ...env }, timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES };
      execFile(file, [...args], options, (error, stdout, stderr) => {
        if (error === null) {
          resolve({ code: 0, stdout, stderr });
          return;
        }
        resolve({ code: exitCode(error.code), stdout, stderr: stderr === '' ? error.message : stderr });
      });
    });
}

export const realExec: Exec = execWithTimeout(EXEC_TIMEOUT_MS);
