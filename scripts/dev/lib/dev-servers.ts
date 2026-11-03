// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import process from 'node:process';
import type { Io } from '../../ci/lib/io.ts';
import { LOOPBACK } from '../../ci/lib/ports.ts';
import { type Child, type Supervision, supervise } from './dev-supervise.ts';
import { isSet } from './server-port.ts';

// E17-S01: `yarn dev` runs the Fastify dev server and the Vite dev server of src/web together, each on a random free
// loopback port above 32768 (docs/ci-runners.md, Ports; never 3000 and never Vite's 5173). The package.json script is
// `node scripts/dev/db.ts run app -- node scripts/dev/dev.ts`: db.ts has already picked the database and the app's PORT,
// so this script starts the app with them, picks Vite's port, and keeps the two together.

type Env = Readonly<Record<string, string | undefined>>;

export interface ServersDeps {
  readonly pickPort: () => Promise<number>;
  /** Starts a command with `env` added to the environment, stdio inherited. */
  readonly start: (command: string, args: readonly string[], env: Readonly<Record<string, string>>) => Child;
  readonly onStop: Supervision['onStop'];
}

export interface Context {
  readonly root: string;
  readonly env: Env;
  readonly deps: ServersDeps;
  readonly io: Io;
}

/** Vite's own executable, run with the same Node as this script so no PATH lookup and no extra process is involved. */
const viteExecutable = (root: string): string => path.join(root, 'node_modules/vite/bin/vite.js');

/** A random free port that is not the app's: the two servers never share one, even when the draw repeats. */
async function otherPort(deps: ServersDeps, taken: string): Promise<number> {
  let port = await deps.pickPort();
  while (String(port) === taken) {
    port = await deps.pickPort();
  }
  return port;
}

/** Exit code: 0 after a requested stop, the dead child's code (1 when it exited 0) otherwise, 1 when PORT is missing. */
export async function runDevServers(context: Context): Promise<number> {
  const { root, env, deps, io } = context;
  const appPort = env['PORT'] ?? '';
  if (!/^\d+$/.test(appPort)) {
    io.err('dev: PORT is not set, so the app has no port to listen on: run `yarn dev`, which picks one');
    return 1;
  }
  const vitePort = await otherPort(deps, appPort);
  // `localhost`, as the app's own default PUBLIC_BASE_URL: browsers accept the Secure session cookie there over plain http.
  const origin = `http://localhost:${vitePort}`;
  io.out(
    `web: ${origin} (Vite on ${LOOPBACK}:${vitePort}; forwards /api, /healthz and /readyz to the app on port ${appPort})`,
  );
  // The app compares the Origin of every POST, PUT, PATCH and DELETE with PUBLIC_BASE_URL (E10-S03), and the browser's
  // Origin is Vite's, so the app is told that its public address is Vite's unless the person chose one.
  const appEnv = isSet(env, 'PUBLIC_BASE_URL') ? {} : { PUBLIC_BASE_URL: origin };
  return supervise(
    [
      ['the app', deps.start(process.execPath, ['--watch', 'src/server/main.ts'], appEnv)],
      [
        'Vite',
        deps.start(
          process.execPath,
          [viteExecutable(root), '--host', LOOPBACK, '--port', String(vitePort), '--strictPort'],
          {},
        ),
      ],
    ],
    { onStop: deps.onStop, io },
  );
}
