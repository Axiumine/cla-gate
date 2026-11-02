// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import os from 'node:os';
import process from 'node:process';
import { runChild } from '../../dev/lib/child-runner.ts';
import { realExec } from './exec.ts';
import type { CliDeps } from './postgres-deps.ts';
import { systemDeps as postgresDeps } from './postgres-deps.ts';

export interface E2eDeps extends Pick<CliDeps, 'exec' | 'randomHex' | 'appendFile'> {
  /** Runs a command with `env` added to the environment, stdio inherited; resolves with its exit code. */
  readonly run: (command: string, args: readonly string[], env: Readonly<Record<string, string>>) => Promise<number>;
  readonly cwd: () => string;
  /** `-1` on a system without POSIX users. */
  readonly user: () => { readonly uid: number; readonly gid: number };
}

/** The real dependencies: docker on PATH, streamed output, the current directory and the user running the helper. */
export const systemDeps: E2eDeps = {
  exec: realExec,
  randomHex: postgresDeps.randomHex,
  appendFile: postgresDeps.appendFile,
  run: runChild,
  cwd: () => process.cwd(),
  user: () => {
    const { uid, gid } = os.userInfo();
    return { uid, gid };
  },
};
