// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { printable } from '../../code-caps/types.ts';
import { ownedName } from './container-owner.ts';
import type { Env } from './env.ts';
import { sinkFor } from './env-sink.ts';
import { reportLines } from './errors.ts';
import type { Io } from './io.ts';
import { startPostgres, stopPostgres } from './postgres-container.ts';
import type { CliDeps } from './postgres-deps.ts';
import { POSTGRES_OWNER } from './postgres-run.ts';

const USAGE = 'usage: ci-postgres <start|stop>';

/**
 * `cla-pg-<run id>-<attempt>-<random>`: unique per run and attempt, see {@link ownedName}.
 */
export function containerName(env: Env, hex: string): string {
  return ownedName(POSTGRES_OWNER, env, hex);
}

async function start(env: Env, io: Io, deps: CliDeps): Promise<number> {
  const sink = sinkFor(env, io, deps.appendFile);
  const password = deps.randomHex(24);
  const name = containerName(env, deps.randomHex(4));
  // Mask first, export the name before docker runs: a failure from here on can still be cleaned up by `stop`.
  sink.secret(password);
  sink.set('CLA_PG_CONTAINER', name);
  const started = await startPostgres(deps, { name, password });
  sink.set('DATABASE_URL', started.url);
  io.out(`container ${name} is healthy on 127.0.0.1:${started.port}`);
  return 0;
}

async function stop(env: Env, io: Io, deps: CliDeps): Promise<number> {
  const name = env['CLA_PG_CONTAINER'] ?? '';
  if (name === '') {
    io.out('no container recorded in CLA_PG_CONTAINER: nothing to remove');
    return 0;
  }
  io.out(`container ${printable(name)}: ${await stopPostgres(deps.exec, name)}`);
  return 0;
}

/** Exit code: 0 ok, 1 failure, 2 usage. `start` and `stop` are the only commands. */
export async function runPostgresCli(argv: readonly string[], env: Env, io: Io, deps: CliDeps): Promise<number> {
  const command = argv.length === 1 ? argv[0] : undefined;
  if (command !== 'start' && command !== 'stop') {
    io.err(USAGE);
    return 2;
  }
  try {
    return await (command === 'start' ? start(env, io, deps) : stop(env, io, deps));
  } catch (error) {
    reportLines('ci-postgres', command, error).forEach((line) => {
      io.err(line);
    });
    return 1;
  }
}
