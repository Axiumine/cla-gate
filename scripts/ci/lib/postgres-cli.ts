// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { printable } from '../../code-caps/types.ts';
import { messageOf } from './errors.ts';
import type { Io } from './io.ts';
import { startPostgres, stopPostgres } from './postgres-container.ts';
import type { CliDeps } from './postgres-deps.ts';
import { CONTAINER_PREFIX } from './postgres-run.ts';

export type Env = Readonly<Record<string, string | undefined>>;

const USAGE = 'usage: ci-postgres <start|stop>';
const DIGITS = /^\d{1,20}$/;

/**
 * `cla-pg-<run id>-<attempt>-<random>`: unique per run and attempt, and the random tail keeps two helpers of the same
 * run (or two local shells) apart. The ids come from GITHUB_RUN_ID and GITHUB_RUN_ATTEMPT and are used only when they
 * are plain numbers, so no other field can reach a container name.
 */
export function containerName(env: Env, hex: string): string {
  const runId = env['GITHUB_RUN_ID'] ?? '';
  const attempt = env['GITHUB_RUN_ATTEMPT'] ?? '';
  const prefix = DIGITS.test(runId) && DIGITS.test(attempt) ? `${runId}-${attempt}` : 'local';
  return `${CONTAINER_PREFIX}${prefix}-${hex}`;
}

interface Sink {
  /** Hides `value` in the Actions log. */
  readonly secret: (value: string) => void;
  /** Exports `name=value` to the next steps (the GITHUB_ENV file), or prints it outside Actions. */
  readonly set: (name: string, value: string) => void;
}

function sinkFor(env: Env, io: Io, deps: CliDeps): Sink {
  const file = env['GITHUB_ENV'] ?? '';
  if (file === '') {
    return {
      secret: () => undefined,
      set: (name, value) => {
        io.out(`${name}=${value}`);
      },
    };
  }
  return {
    secret: (value) => {
      io.out(`::add-mask::${value}`);
    },
    set: (name, value) => {
      deps.appendFile(file, `${name}=${value}\n`);
    },
  };
}

async function start(env: Env, io: Io, deps: CliDeps): Promise<number> {
  const sink = sinkFor(env, io, deps);
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

/**
 * One report line per message line. Continuation lines (container logs) get a `| ` prefix and lose their control
 * characters, so nothing a container prints can start with `::` and pass for a workflow command.
 */
function errorLines(command: string, error: unknown): string[] {
  const [first = '', ...rest] = messageOf(error).split('\n');
  return [`ci-postgres ${command}: ${first}`, ...rest.map((line) => `| ${line}`)];
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
    errorLines(command, error).forEach((line) => {
      io.err(line);
    });
    return 1;
  }
}
