// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Io } from '../../ci/lib/io.ts';
import { LOOPBACK } from '../../ci/lib/ports.ts';

type Env = Readonly<Record<string, string | undefined>>;

/** An empty variable counts as unset. */
export function isSet(env: Env, variable: string): boolean {
  return (new Map(Object.entries(env)).get(variable) ?? '') !== '';
}

/**
 * The dev server listens on a random free port too, never on the well-known 3000 (docs/ci-runners.md, Ports). The port
 * is chosen once, here, so `node --watch` restarts keep it; an explicit PORT wins.
 */
export async function serverPort(env: Env, pickPort: () => Promise<number>, io: Io): Promise<Record<string, string>> {
  if (isSet(env, 'PORT')) {
    return {};
  }
  const port = await pickPort();
  io.out(`app: http://${LOOPBACK}:${port} (PORT was not set: a random free port above 32768)`);
  return { PORT: String(port) };
}
