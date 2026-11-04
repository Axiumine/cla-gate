// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { systemDeps as e2eDeps } from './e2e-deps.ts';
import { realExec } from './exec.ts';
import { systemDeps as postgresDeps } from './postgres-deps.ts';

export interface CaddyDeps extends Pick<typeof e2eDeps, 'exec' | 'randomHex' | 'appendFile' | 'user'> {
  /** Absolute path of docker/Caddyfile. */
  readonly caddyfile: string;
}

/** The real dependencies: docker on PATH, crypto randomness, the user running the helper and the Caddyfile of this checkout. */
export const systemDeps: CaddyDeps = {
  exec: realExec,
  randomHex: postgresDeps.randomHex,
  appendFile: postgresDeps.appendFile,
  user: e2eDeps.user,
  caddyfile: path.resolve(import.meta.dirname, '../../../docker/Caddyfile'),
};
