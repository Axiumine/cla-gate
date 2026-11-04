// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import type { ExecResult } from '../ci/lib/exec.ts';
import type { composer } from './compose.ts';
import { tail } from './compose.ts';
import { withSettings } from './dotenv.ts';
import { writeText } from './files.ts';
import type { Run, StackDeps, StackInfo, StackOptions } from './stack-types.ts';

// E19-S08: `docker compose up --build --wait` for a smoke stack, with the random port and subnet that it needs.

const ATTEMPTS = 5;
const WAIT_SECONDS = 300;
const SECOND_OCTET_MIN = 16;
const SECOND_OCTET_MAX = 31;
const OCTET_MAX = 255;
/** Draws of a port that is already taken by another setting of the same stack before the attempt is given up. */
const DRAWS = 20;

/** A port or a subnet that another process took between the choice and the bind: the next draw may fit. */
const CONFLICT = /port is already allocated|address already in use|ports are not available|pool overlaps/i;

/** A /24 in 172.16.0.0/12, drawn at random: two stacks on one daemon must not claim the same one. */
export function randomSubnet(randomInt: StackDeps['randomInt']): string {
  return `172.${randomInt(SECOND_OCTET_MIN, SECOND_OCTET_MAX)}.${randomInt(0, OCTET_MAX)}.0/24`;
}

/** A random free port that is none of `used`: two settings of one stack must not share a port. */
async function freshPort(pickPort: StackDeps['pickPort'], used: readonly number[]): Promise<number> {
  for (let draw = 0; draw < DRAWS; draw += 1) {
    const port = await pickPort();
    if (!used.includes(port)) {
      return port;
    }
  }
  throw new Error(`no free port that differs from the ${used.length} already drawn after ${DRAWS} draws`);
}

type Up = Pick<StackInfo, 'port' | 'environment'>;
type Options = StackOptions & { readonly directory: string; readonly dotenv: string };

/** The application's port and the settings of one attempt: the smoke test's own, a port for each name in `ports`, then the caller's. */
async function settingsFor(deps: StackDeps, options: Options): Promise<Up> {
  const port = await deps.pickPort();
  const used = [port];
  const named: [string, string][] = [];
  for (const name of options.ports ?? []) {
    const next = await freshPort(deps.pickPort, used);
    used.push(next);
    named.push([name, String(next)]);
  }
  const subnet = randomSubnet(deps.randomInt);
  return {
    port,
    environment: {
      PUBLIC_BASE_URL: 'https://localhost',
      BIND_ADDRESS: '127.0.0.1',
      PORT: String(port),
      EDGE_SUBNET: subnet,
      TRUST_PROXY: subnet,
      ...Object.fromEntries(named),
      ...options.settings,
    },
  };
}

/**
 * `docker compose up --build --wait`, of the named services only when there are any. Then everything is created first
 * (`--no-start`): the image is built once, before a `docker compose run` of a service that does not start would build it on its
 * own, twice at once, and every network exists, so that a subnet that overlaps another network fails here, inside the attempt
 * that can draw another, and not later when the scenario starts the rest of the stack.
 */
async function upServices(compose: Run, services: readonly string[]): Promise<ExecResult> {
  const wait = ['--detach', '--wait', '--wait-timeout', String(WAIT_SECONDS)];
  if (services.length === 0) {
    return compose(['up', '--build', ...wait]);
  }
  const created = await compose(['up', '--build', '--no-start']);
  return created.code === 0 ? compose(['up', ...wait, ...services]) : created;
}

/**
 * Starts the stack and waits until every service (the ones named in `options.services`, when it has any) is healthy or has
 * finished. A port or a subnet that was taken in between is drawn again, up to {@link ATTEMPTS} times; any other failure is
 * final.
 */
export async function bringUp(deps: StackDeps, start: ReturnType<typeof composer>, options: Options): Promise<Up> {
  for (let attempt = 1; ; attempt += 1) {
    const chosen = await settingsFor(deps, options);
    writeText(path.join(options.directory, '.env'), withSettings(options.dotenv, chosen.environment));
    // The same settings go to the child's environment: a variable of the same name in the shell outranks the dotenv file in compose.
    const compose = start((options.profiles ?? []).join(','), chosen.environment);
    const up = await upServices(compose, options.services ?? []);
    if (up.code === 0) {
      return chosen;
    }
    if (attempt >= ATTEMPTS || !CONFLICT.test(up.stderr)) {
      throw new Error(`docker compose up failed (exit ${up.code}):\n${tail(up)}`);
    }
    await compose(['down', '--volumes', '--remove-orphans']);
  }
}
