// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { printable } from '../../code-caps/types.ts';
import { ownedName, removeOwned } from './container-owner.ts';
import type { E2eDeps } from './e2e-deps.ts';
import { E2E_OWNER, IMAGE_PATTERN, IMAGE_VARIABLE, isMountable, runArguments } from './e2e-run.ts';
import { type Env, variable } from './env.ts';
import { sinkFor } from './env-sink.ts';
import { reportLines } from './errors.ts';
import type { Io } from './io.ts';

const USAGE = ['usage: ci-e2e run [--] <command...>', '       ci-e2e stop'];
const CONTAINER_VARIABLE = 'CLA_E2E_CONTAINER';

/** `run`'s settings from the environment, or an error that says which one is wrong (never a value that might be a secret). */
function settings(env: Env, deps: E2eDeps) {
  const image = variable(env, IMAGE_VARIABLE);
  if (!IMAGE_PATTERN.test(image)) {
    throw new Error(
      `${IMAGE_VARIABLE} must be mcr.microsoft.com/playwright:v<version>-noble@sha256:<64 hex digits>, got "${printable(image)}"`,
    );
  }
  const database = env['DATABASE_URL'] ?? '';
  if (database === '') {
    throw new Error('DATABASE_URL is not set: start and migrate the database first (yarn ci:postgres start)');
  }
  const workspace = deps.cwd();
  if (!isMountable(workspace)) {
    throw new Error(
      `the working directory "${printable(workspace)}" cannot be mounted: it must be absolute and have no ":"`,
    );
  }
  const { uid, gid } = deps.user();
  if (uid < 0 || gid < 0) {
    throw new Error('the Playwright container must run as the current user, and this system has no numeric user id');
  }
  return { image, database, workspace, user: `${uid}:${gid}`, ci: env['CI'] ?? '' };
}

/** The command after `run`; a single leading `--` is only a separator. */
function commandOf(args: readonly string[]): readonly string[] {
  return args[0] === '--' ? args.slice(1) : args;
}

async function runCommand(command: readonly string[], env: Env, io: Io, deps: E2eDeps): Promise<number> {
  const { image, database, workspace, user, ci } = settings(env, deps);
  const name = ownedName(E2E_OWNER, env, deps.randomHex(4));
  // The name goes to the next steps before docker runs: a cancelled step can still be cleaned up by `stop`.
  sinkFor(env, io, deps.appendFile).set(CONTAINER_VARIABLE, name);
  io.out(`container ${name}: ${command.join(' ')}`);
  const code = await deps.run('docker', runArguments({ name, image, workspace, user, ci }, command), {
    DATABASE_URL: database,
  });
  io.out(`container ${name}: exit code ${code}`);
  return code;
}

async function stopCommand(env: Env, io: Io, deps: E2eDeps): Promise<number> {
  const name = variable(env, CONTAINER_VARIABLE);
  if (name === '') {
    io.out(`no container recorded in ${CONTAINER_VARIABLE}: nothing to remove`);
    return 0;
  }
  io.out(`container ${printable(name)}: ${await removeOwned(deps.exec, name, E2E_OWNER)}`);
  return 0;
}

/** Exit code: the command's own for `run` (125 to 127 are docker's), 1 for a setup failure, 2 for usage. */
export async function runE2eCli(argv: readonly string[], env: Env, io: Io, deps: E2eDeps): Promise<number> {
  const [command = '', ...args] = argv;
  const wanted = commandOf(args);
  const valid = (command === 'run' && wanted.length > 0) || (command === 'stop' && args.length === 0);
  if (!valid) {
    USAGE.forEach((line) => {
      io.err(line);
    });
    return 2;
  }
  try {
    return await (command === 'run' ? runCommand(wanted, env, io, deps) : stopCommand(env, io, deps));
  } catch (error) {
    reportLines('ci-e2e', command, error).forEach((line) => {
      io.err(line);
    });
    return 1;
  }
}
