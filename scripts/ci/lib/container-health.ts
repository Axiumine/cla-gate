// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Exec } from './exec.ts';

const POLL_MS = 1000;
const LOG_LINES = 20;
const FAILED_STATES: ReadonlySet<string> = new Set(['exited', 'dead', 'removing']);

export class ContainerError extends Error {
  override readonly name = 'ContainerError';
}

export interface HealthDeps {
  readonly exec: Exec;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
}

async function recentLogs(exec: Exec, name: string): Promise<string> {
  const result = await exec('docker', ['logs', '--tail', String(LOG_LINES), name]);
  return `${result.stdout}${result.stderr}`.trim();
}

/** `running healthy`, `running starting`, `exited unhealthy`, ... as one string, or '' when inspect failed. */
async function containerState(exec: Exec, name: string): Promise<string> {
  const format = '{{.State.Status}} {{.State.Health.Status}}';
  const result = await exec('docker', ['inspect', '--format', format, name]);
  return result.code === 0 ? result.stdout.trim() : '';
}

/** Why a state can never turn healthy, or undefined while it still can. */
function failure(state: string): string | undefined {
  const [status = '', health = ''] = state.split(' ');
  const dead = status === '' || FAILED_STATES.has(status) || health === 'unhealthy';
  return dead ? `is ${status || 'gone'} (${health || 'no health'})` : undefined;
}

/** Resolves when the health check passes; throws (with the last log lines) on a dead container or the deadline. */
export async function waitHealthy(deps: HealthDeps, name: string, timeoutMs: number): Promise<void> {
  const deadline = deps.now() + timeoutMs;
  for (;;) {
    const state = await containerState(deps.exec, name);
    if (state === 'running healthy') {
      return;
    }
    const why = failure(state) ?? (deps.now() >= deadline ? `was not healthy after ${timeoutMs} ms` : undefined);
    if (why !== undefined) {
      throw new ContainerError(`container ${name} ${why}:\n${await recentLogs(deps.exec, name)}`);
    }
    await deps.sleep(POLL_MS);
  }
}
