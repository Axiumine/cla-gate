// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { ContainerError } from './container-health.ts';
import type { Env } from './env.ts';
import type { Exec } from './exec.ts';

// The Docker daemon of a runner is shared with other repositories, so every container a helper of this repository creates
// carries a name prefix and a label, and the helper removes nothing else (docs/ci-runners.md, Containers and cleanup).
// Shared by the postgres helper (E20-S03) and the Playwright helper (E20-S06).

export interface Owner {
  /** Every container name the helper creates starts with this. */
  readonly prefix: string;
  /** The label that marks them, as `key=value`. */
  readonly labelKey: string;
  readonly labelValue: string;
}

/** What Docker accepts as a name, minus the characters that could pass for an option when handed to the CLI. */
export const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/;

const DIGITS = /^\d{1,20}$/;

export function labelOf(owner: Owner): string {
  return `${owner.labelKey}=${owner.labelValue}`;
}

/** `<run id>-<attempt>` when both come from the environment as plain numbers, else `local`. */
function runPrefix(env: Env): string {
  const runId = env['GITHUB_RUN_ID'] ?? '';
  const attempt = env['GITHUB_RUN_ATTEMPT'] ?? '';
  return DIGITS.test(runId) && DIGITS.test(attempt) ? `${runId}-${attempt}` : 'local';
}

/**
 * `<prefix><run id>-<attempt>-<random>`: unique per run and attempt, and the random tail keeps two helpers of the same
 * run (or two local shells) apart. The ids come from GITHUB_RUN_ID and GITHUB_RUN_ATTEMPT and are used only when they
 * are plain numbers, so no other field can reach a container name.
 */
export function ownedName(owner: Owner, env: Env, hex: string): string {
  return `${owner.prefix}${runPrefix(env)}-${hex}`;
}

/** One line of docker's stderr is enough for a log; the rest is noise. */
export function firstLine(text: string): string {
  return text.trim().split('\n', 1).join('');
}

const NO_SUCH_CONTAINER = /no such (container|object)/i;

/** The value of the owner's label on the container, or undefined when there is no such container. */
async function ownerLabel(exec: Exec, name: string, owner: Owner): Promise<string | undefined> {
  const format = `{{index .Config.Labels "${owner.labelKey}"}}`;
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
 * Removes the container and its anonymous volume. Idempotent: a container that is already gone is not an error. It
 * removes only a name that starts with the owner's prefix and a container that carries the owner's label.
 */
export async function removeOwned(exec: Exec, name: string, owner: Owner): Promise<'removed' | 'absent'> {
  if (!NAME_PATTERN.test(name) || !name.startsWith(owner.prefix)) {
    throw new ContainerError('refusing to remove a container with an unexpected name');
  }
  const label = await ownerLabel(exec, name, owner);
  if (label === undefined) {
    return 'absent';
  }
  if (label !== owner.labelValue) {
    throw new ContainerError(`refusing to remove container ${name}: it does not carry the label ${labelOf(owner)}`);
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
