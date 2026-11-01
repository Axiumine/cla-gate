// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import { messageOf } from '../../ci/lib/errors.ts';
import { realExec } from '../../ci/lib/exec.ts';
import type { Io } from '../../ci/lib/io.ts';
import { LOOPBACK, pickSystemFreePort } from '../../ci/lib/ports.ts';
import { runChild } from './child-runner.ts';
import { type DevDeps, databaseDown, databaseUp, type Role, requireUrl, roleVariable } from './dev-db.ts';
import { isSet, serverPort } from './server-port.ts';

type Env = Readonly<Record<string, string | undefined>>;

export interface CliDeps extends DevDeps {
  /** Runs a command with `env` added to the environment, stdio inherited; resolves with its exit code. */
  readonly run: (command: string, args: readonly string[], env: Readonly<Record<string, string>>) => Promise<number>;
}

const USAGE = [
  'usage: db <command>',
  '  up                    start PostgreSQL 18 on a random free 127.0.0.1 port (yarn db:up)',
  '  url [app|owner]       print the connection pieces, or one bare URL (yarn db:url)',
  '  down [--volumes]      stop and remove the container; --volumes also deletes the data (yarn db:down)',
  '  run <app|owner> -- <command...>   run a command with DATABASE_URL (app) or MIGRATION_DATABASE_URL (owner) set;',
  '                        app also sets PORT to a random free port above 32768 unless PORT is already set (yarn dev)',
];

function isRole(value: string | undefined): value is Role {
  return value === 'app' || value === 'owner';
}

/** The real dependencies: docker on PATH, a bind probe on 127.0.0.1, child processes. */
export const systemDeps: CliDeps = { exec: realExec, pickPort: pickSystemFreePort, run: runChild };

export interface Context {
  readonly root: string;
  readonly env: Env;
  readonly deps: CliDeps;
  readonly io: Io;
}

/** A command handler resolves with an exit code, or with undefined when its arguments are wrong (usage, exit 2). */
type Handler = (args: readonly string[], context: Context) => Promise<number | undefined>;

const up: Handler = async (args, { root, deps, io }) => {
  if (args.length > 0) {
    return undefined;
  }
  const port = await databaseUp(deps, root);
  io.out(`PostgreSQL 18 is up on 127.0.0.1:${port} (yarn db:url prints the connection strings)`);
  return 0;
};

const down: Handler = async (args, { root, deps, io }) => {
  const [flag, ...extra] = args;
  if (extra.length > 0 || (flag !== undefined && flag !== '--volumes')) {
    return undefined;
  }
  await databaseDown(deps, root, flag !== undefined);
  io.out('PostgreSQL stopped and removed');
  return 0;
};

const url: Handler = (args, { root, io }) => {
  const [role, ...extra] = args;
  if (extra.length > 0 || (role !== undefined && !isRole(role))) {
    return Promise.resolve(undefined);
  }
  if (role === undefined) {
    // Both URLs first: when nothing is recorded, nothing is printed.
    const [app, owner] = [requireUrl(root, 'app'), requireUrl(root, 'owner')];
    io.out(`POSTGRES_HOST=${LOOPBACK}`);
    io.out(`POSTGRES_PORT=${new URL(app).port}`);
    io.out(`DATABASE_URL=${app}`);
    io.out(`MIGRATION_DATABASE_URL=${owner}`);
  } else {
    io.out(requireUrl(root, role));
  }
  return Promise.resolve(0);
};

const run: Handler = async (args, { root, env, deps, io }) => {
  const [role, separator, command, ...rest] = args;
  if (!isRole(role) || separator !== '--' || command === undefined) {
    return undefined;
  }
  const variable = roleVariable(role);
  // An explicit variable wins over the remembered database, so a dev server can point anywhere.
  const database = isSet(env, variable) ? {} : Object.fromEntries([[variable, requireUrl(root, role)]]);
  const server = role === 'app' ? await serverPort(env, deps.pickPort, io) : {};
  return deps.run(command, rest, { ...database, ...server });
};

const HANDLERS: ReadonlyMap<string, Handler> = new Map([
  ['up', up],
  ['down', down],
  ['url', url],
  ['run', run],
]);

/** Exit code: the wrapped command's for `run`, otherwise 0 ok, 1 failure (docker, nothing recorded), 2 usage. */
export async function runDevDbCli(argv: readonly string[], context: Context): Promise<number> {
  try {
    const [command = '', ...args] = argv;
    const code = await HANDLERS.get(command)?.(args, context);
    if (code !== undefined) {
      return code;
    }
    USAGE.forEach((line) => {
      context.io.err(line);
    });
    return 2;
  } catch (error) {
    context.io.err(`db: ${messageOf(error)}`);
    return 1;
  }
}
