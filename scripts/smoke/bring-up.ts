// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import type { composer } from './compose.ts';
import { tail } from './compose.ts';
import { withSettings } from './dotenv.ts';
import { writeText } from './files.ts';
import type { StackDeps, StackInfo, StackOptions } from './stack-types.ts';

// E19-S08: `docker compose up --build --wait` for a smoke stack, with the random port and subnet that it needs.

const ATTEMPTS = 5;
const WAIT_SECONDS = 300;
const SECOND_OCTET_MIN = 16;
const SECOND_OCTET_MAX = 31;
const OCTET_MAX = 255;

/** A port or a subnet that another process took between the choice and the bind: the next draw may fit. */
const CONFLICT = /port is already allocated|address already in use|ports are not available|pool overlaps/i;

/** A /24 in 172.16.0.0/12, drawn at random: two stacks on one daemon must not claim the same one. */
export function randomSubnet(randomInt: StackDeps['randomInt']): string {
  return `172.${randomInt(SECOND_OCTET_MIN, SECOND_OCTET_MAX)}.${randomInt(0, OCTET_MAX)}.0/24`;
}

type Up = Pick<StackInfo, 'port' | 'environment'>;

/**
 * Starts the stack and waits until every service is healthy or has finished. A port or a subnet that was taken in between is
 * drawn again, up to {@link ATTEMPTS} times; any other failure is final.
 */
export async function bringUp(
  deps: StackDeps,
  start: ReturnType<typeof composer>,
  options: StackOptions & { readonly directory: string; readonly dotenv: string },
): Promise<Up> {
  for (let attempt = 1; ; attempt += 1) {
    const port = await deps.pickPort();
    const subnet = randomSubnet(deps.randomInt);
    const settings = {
      PUBLIC_BASE_URL: 'https://localhost',
      BIND_ADDRESS: '127.0.0.1',
      PORT: String(port),
      EDGE_SUBNET: subnet,
      TRUST_PROXY: subnet,
      ...options.settings,
    };
    writeText(path.join(options.directory, '.env'), withSettings(options.dotenv, settings));
    // The same settings go to the child's environment: a variable of the same name in the shell outranks .env in compose.
    const compose = start((options.profiles ?? []).join(','), settings);
    const up = await compose(['up', '--build', '--detach', '--wait', '--wait-timeout', String(WAIT_SECONDS)]);
    if (up.code === 0) {
      return { port, environment: settings };
    }
    if (attempt >= ATTEMPTS || !CONFLICT.test(up.stderr)) {
      throw new Error(`docker compose up failed (exit ${up.code}):\n${tail(up)}`);
    }
    await compose(['down', '--volumes', '--remove-orphans']);
  }
}
