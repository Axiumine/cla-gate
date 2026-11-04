// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { printable } from '../../code-caps/types.ts';
import type { CaddyDeps } from './caddy-deps.ts';
import { CADDY_IMAGE, CADDY_OWNER, isHttpsOrigin, isMountableFile, validateArguments } from './caddy-run.ts';
import { ContainerError } from './container-health.ts';
import { ownedName, removeOwned } from './container-owner.ts';
import { type Env, variable } from './env.ts';
import { sinkFor } from './env-sink.ts';
import { reportLines } from './errors.ts';
import type { Io } from './io.ts';

const USAGE = ['usage: ci-caddy validate [origin...]', '       ci-caddy stop'];
const CONTAINER_VARIABLE = 'CLA_CADDY_CONTAINER';
const LOG_LINES = 20;

/** The values of PUBLIC_BASE_URL the job checks when none is given: the one the TLS smoke scenario uses, and a public name. */
export const DEFAULT_ORIGINS: readonly string[] = ['https://localhost', 'https://cla.example.com'];

/** The last lines of what the container printed: Caddy's reason comes last, and the rest is its start-up noise. */
function tail(result: { readonly stdout: string; readonly stderr: string }): string {
  return `${result.stderr}${result.stdout}`.trim().split('\n').slice(-LOG_LINES).join('\n');
}

/** The settings of `validate`, or an error that says which one is wrong. */
function settings(origins: readonly string[], deps: CaddyDeps) {
  const bad = origins.find((origin) => !isHttpsOrigin(origin));
  if (bad !== undefined) {
    throw new Error(`"${printable(bad)}" is not an https origin: https:// and a lower-case host name, no port or path`);
  }
  if (!isMountableFile(deps.caddyfile)) {
    throw new Error(`the Caddyfile path "${printable(deps.caddyfile)}" cannot be mounted: absolute, no comma`);
  }
  const { uid, gid } = deps.user();
  if (uid < 0 || gid < 0) {
    throw new Error('the Caddy container must run as the current user, and this system has no numeric user id');
  }
  return { caddyfile: deps.caddyfile, user: `${uid}:${gid}` };
}

async function validate(origins: readonly string[], env: Env, io: Io, deps: CaddyDeps): Promise<number> {
  const { caddyfile, user } = settings(origins, deps);
  const name = ownedName(CADDY_OWNER, env, deps.randomHex(4));
  // The name goes to the next steps before docker runs: a cancelled step can still be cleaned up by `stop`.
  sinkFor(env, io, deps.appendFile).set(CONTAINER_VARIABLE, name);
  // One after the other: they share the name, and `--rm` has freed it when the previous one has stopped.
  for (const origin of origins) {
    const result = await deps.exec('docker', validateArguments({ name, image: CADDY_IMAGE, caddyfile, user, origin }));
    if (result.code !== 0) {
      throw new ContainerError(`caddy validate failed for ${origin} (exit code ${result.code}):\n${tail(result)}`);
    }
    io.out(`caddy validate ${origin}: valid`);
  }
  return 0;
}

async function stop(env: Env, io: Io, deps: CaddyDeps): Promise<number> {
  const name = variable(env, CONTAINER_VARIABLE);
  if (name === '') {
    io.out(`no container recorded in ${CONTAINER_VARIABLE}: nothing to remove`);
    return 0;
  }
  io.out(`container ${printable(name)}: ${await removeOwned(deps.exec, name, CADDY_OWNER)}`);
  return 0;
}

/**
 * Exit code: 0 ok, 1 failure (an invalid configuration included), 2 usage. `validate` checks docker/Caddyfile for each origin
 * given, or for {@link DEFAULT_ORIGINS}; `stop` removes the container a cancelled `validate` may have left.
 */
export async function runCaddyCli(argv: readonly string[], env: Env, io: Io, deps: CaddyDeps): Promise<number> {
  const [command = '', ...args] = argv;
  if (!(command === 'validate' || (command === 'stop' && args.length === 0))) {
    USAGE.forEach((line) => {
      io.err(line);
    });
    return 2;
  }
  const origins = args.length === 0 ? DEFAULT_ORIGINS : args;
  try {
    return await (command === 'validate' ? validate(origins, env, io, deps) : stop(env, io, deps));
  } catch (error) {
    reportLines('ci-caddy', command, error).forEach((line) => {
      io.err(line);
    });
    return 1;
  }
}
