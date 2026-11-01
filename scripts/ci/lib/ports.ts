// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { randomInt } from 'node:crypto';
import net from 'node:net';

/**
 * The range every port of this repository comes from (docs/ci-runners.md, Ports). The floor is above 32768 on purpose:
 * Docker's own host-port assignment is sequential (32808, 32809, ...) and the ephemeral range is a sysctl that other
 * machines may change, so we choose the port ourselves, randomly, and bind it on loopback only.
 */
export const PORT_MIN = 32_769;
export const PORT_MAX = 60_999;
export const LOOPBACK = '127.0.0.1';
const DEFAULT_ATTEMPTS = 50;

/** Docker and Compose word a lost race for the port this way. */
const PORT_TAKEN = /port is already allocated|address already in use|ports are not available/i;

export class PortError extends Error {
  override readonly name = 'PortError';
}

export interface PortDeps {
  /** A uniform integer from `min` to `max`, both included. */
  readonly randomInt: (min: number, max: number) => number;
  /** True when nothing holds the port right now. */
  readonly isFree: (port: number) => Promise<boolean>;
  readonly attempts?: number;
}

/** Tries to listen on the loopback port; any failure (in use, not permitted) means "not free". */
export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.listen({ port, host: LOOPBACK, exclusive: true }, () => {
      server.close(() => {
        resolve(true);
      });
    });
  });
}

/** Random free port in PORT_MIN..PORT_MAX; throws a PortError when `attempts` random draws were all taken. */
export async function pickFreePort(deps: PortDeps): Promise<number> {
  const attempts = deps.attempts ?? DEFAULT_ATTEMPTS;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const port = deps.randomInt(PORT_MIN, PORT_MAX);
    if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) {
      throw new PortError(`random source returned ${port}, outside ${PORT_MIN}..${PORT_MAX}`);
    }
    if (await deps.isFree(port)) {
      return port;
    }
  }
  throw new PortError(`no free port in ${PORT_MIN}..${PORT_MAX} after ${attempts} attempts`);
}

/** The real thing: crypto randomness and a bind probe on 127.0.0.1. */
export function pickSystemFreePort(): Promise<number> {
  return pickFreePort({ randomInt: (min, max) => randomInt(min, max + 1), isFree: isPortFree });
}

export interface Attempt {
  readonly code: number;
  readonly stderr: string;
}

export interface RetryOptions<T extends Attempt> {
  readonly pickPort: () => Promise<number>;
  /** Starts whatever needs the port. */
  readonly run: (port: number) => Promise<T>;
  /** Undoes a failed `run` before the next attempt (a half-created container). */
  readonly reset: (port: number) => Promise<void>;
  readonly attempts: number;
}

/**
 * Probing and binding are two steps, so the port can be taken in between. Runs `run` with a fresh port until it
 * succeeds or fails for a reason other than a taken port (the caller reads the result); throws when every one of the
 * `attempts` lost the race.
 */
export async function withFreePort<T extends Attempt>(options: RetryOptions<T>): Promise<{ port: number; result: T }> {
  for (let attempt = 0; attempt < options.attempts; attempt += 1) {
    const port = await options.pickPort();
    const result = await options.run(port);
    if (result.code === 0 || !PORT_TAKEN.test(result.stderr)) {
      return { port, result };
    }
    await options.reset(port);
  }
  throw new PortError(`the chosen port was taken ${options.attempts} times in a row`);
}
