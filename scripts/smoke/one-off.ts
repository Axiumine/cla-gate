// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { inspectContainer, lifetimeMs, output } from './probe.ts';
import type { Stack } from './stack-types.ts';
import { type Clock, eventually } from './wait.ts';

// E19-S12: a service started once beside the running stack with settings of its own, such as the application with a
// PUBLIC_BASE_URL it must refuse, and read after it has stopped.

/** How long a one-off container may take to stop on its own before the scenario gives up on it. */
const EXIT_WAIT_MS = 30_000;

export interface OneOff {
  readonly exitCode: number;
  /** From the start Docker recorded to the exit it recorded: the time of the process, without the time Docker needs to create the container. */
  readonly lifetimeMs: number;
  /** Everything the container printed, both streams. */
  readonly output: string;
}

/**
 * `docker compose run --detach --no-deps -e NAME=value ... <service>`: a new container of the service with these variables on
 * top of its own, none of its dependencies started. Waits for it to stop on its own, reports how it ended and removes it, so that
 * `docker compose ps --all` (which lists one-off containers) still shows the service's own container alone. A container that does
 * not stop stays until the stack is taken down.
 */
export async function runOneOff(
  stack: Pick<Stack, 'compose' | 'docker'>,
  clock: Clock,
  service: string,
  environment: Readonly<Record<string, string>>,
): Promise<OneOff> {
  const variables = Object.entries(environment).flatMap(([name, value]) => ['--env', `${name}=${value}`]);
  const started = await stack.compose(['run', '--detach', '--no-deps', ...variables, service]);
  // `compose run --detach` prints the id of the new container on its last line (earlier lines are progress); nothing printed gives ''
  const id = started.stdout.trim().split('\n').slice(-1).join('');
  if (started.code !== 0 || id === '') {
    throw new Error(`docker compose run ${service} failed (exit ${started.code}): ${output(started)}`);
  }
  const stopped = await eventually(clock, `the one-off ${service} to stop`, EXIT_WAIT_MS, async () => {
    const container = await inspectContainer(stack, id, service);
    return container.State.Status === 'exited' ? container : undefined;
  });
  const logs = await stack.docker(['logs', id]);
  await stack.docker(['rm', '--force', '--volumes', id]);
  return { exitCode: stopped.State.ExitCode, lifetimeMs: lifetimeMs(stopped), output: output(logs) };
}
