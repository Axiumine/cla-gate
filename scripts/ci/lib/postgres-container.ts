// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { ContainerError, type HealthDeps, waitHealthy } from './container-health.ts';
import type { Exec } from './exec.ts';
import { withFreePort } from './ports.ts';
import {
  CONTAINER_LABEL,
  CONTAINER_PREFIX,
  databaseUrl,
  LABEL_KEY,
  LABEL_VALUE,
  NAME_PATTERN,
  POSTGRES_IMAGE,
  runArguments,
} from './postgres-run.ts';

const PORT_ATTEMPTS = 5;
const HEALTH_TIMEOUT_MS = 120_000;

export interface StartDeps extends HealthDeps {
  readonly pickPort: () => Promise<number>;
}

export interface StartOptions {
  readonly name: string;
  readonly password: string;
  readonly image?: string;
  readonly portAttempts?: number;
  readonly healthTimeoutMs?: number;
}

export interface Started {
  readonly name: string;
  readonly port: number;
  readonly url: string;
}

/** One line of docker's stderr is enough for a log; the rest is noise. */
function firstLine(text: string): string {
  return text.trim().split('\n', 1).join('');
}

/** `docker run` refused the name because a container of that name exists: not ours to clean up. */
class NameConflictError extends ContainerError {}

const NAME_IN_USE = /container name .* is already in use/i;
const NO_SUCH_CONTAINER = /no such (container|object)/i;

/** The value of our label on the container, or undefined when there is no such container. */
async function ownerLabel(exec: Exec, name: string): Promise<string | undefined> {
  const format = `{{index .Config.Labels "${LABEL_KEY}"}}`;
  const result = await exec('docker', ['container', 'inspect', '--format', format, name]);
  if (result.code === 0) {
    return result.stdout.trim();
  }
  if (NO_SUCH_CONTAINER.test(result.stderr)) {
    return undefined;
  }
  throw new ContainerError(`docker inspect failed: ${firstLine(result.stderr)}`);
}

/**
 * Removes the container and its anonymous volume. Idempotent: a container that is already gone is not an error. The
 * Docker daemon is shared, so it removes only a name that starts with `cla-pg-` and a container that carries our label.
 */
export async function stopPostgres(exec: Exec, name: string): Promise<'removed' | 'absent'> {
  if (!NAME_PATTERN.test(name) || !name.startsWith(CONTAINER_PREFIX)) {
    throw new ContainerError('refusing to remove a container with an unexpected name');
  }
  const label = await ownerLabel(exec, name);
  if (label === undefined) {
    return 'absent';
  }
  if (label !== LABEL_VALUE) {
    throw new ContainerError(`refusing to remove container ${name}: it does not carry the label ${CONTAINER_LABEL}`);
  }
  const result = await exec('docker', ['rm', '--force', '--volumes', name]);
  if (result.code === 0) {
    return result.stdout.trim() === name ? 'removed' : 'absent';
  }
  if (NO_SUCH_CONTAINER.test(result.stderr)) {
    return 'absent';
  }
  throw new ContainerError(`docker rm failed: ${firstLine(result.stderr)}`);
}

async function runOnFreePort(deps: StartDeps, options: StartOptions): Promise<number> {
  const { name, password } = options;
  const { port, result } = await withFreePort({
    pickPort: deps.pickPort,
    attempts: options.portAttempts ?? PORT_ATTEMPTS,
    run: (candidate) =>
      deps.exec('docker', runArguments(name, candidate, options.image ?? POSTGRES_IMAGE), {
        POSTGRES_PASSWORD: password,
      }),
    // docker run -d creates the container before it fails to bind: remove it so the name is free for the next try.
    reset: async () => {
      await stopPostgres(deps.exec, name);
    },
  });
  if (result.code !== 0) {
    const failed = `docker run failed: ${firstLine(result.stderr)}`;
    throw NAME_IN_USE.test(result.stderr) ? new NameConflictError(failed) : new ContainerError(failed);
  }
  return port;
}

/**
 * Starts the pinned image on a random free loopback port and waits until it is healthy. Any failure removes the
 * container again before the error propagates, except a name that was already taken: that container is not ours.
 */
export async function startPostgres(deps: StartDeps, options: StartOptions): Promise<Started> {
  try {
    const port = await runOnFreePort(deps, options);
    await waitHealthy(deps, options.name, options.healthTimeoutMs ?? HEALTH_TIMEOUT_MS);
    return { name: options.name, port, url: databaseUrl(options.password, port) };
  } catch (error) {
    if (!(error instanceof NameConflictError)) {
      await stopPostgres(deps.exec, options.name).catch(() => 'absent');
    }
    throw error;
  }
}
