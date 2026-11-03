// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { ContainerError } from '../ci/lib/container-health.ts';
import { firstLine } from '../ci/lib/container-owner.ts';
import { messageOf } from '../ci/lib/errors.ts';
import type { Exec } from '../ci/lib/exec.ts';
import { runFilters } from './names.ts';

// E19-S08: the `if: always()` step of the `container` job. The test removes its own stacks in its teardown; this removes
// whatever is left of the run when the job was cancelled or the test process was killed: first `docker compose down -v` for
// each project of the run, then every container, network, volume and image that carries the labels of the run.

const projectsSchema = z.array(z.object({ Name: z.string() }));

export interface Removed {
  /** The compose projects that `docker compose down --volumes` was run for. */
  readonly projects: readonly string[];
  readonly containers: number;
  readonly networks: number;
  readonly volumes: number;
  readonly images: number;
}

/** The projects of the run that compose still knows, `cla-smoke-<run>-<scenario>`. */
async function projectsOf(exec: Exec, run: string): Promise<string[]> {
  const listed = await exec('docker', ['compose', 'ls', '--all', '--format', 'json']);
  if (listed.code !== 0) {
    throw new ContainerError(`docker compose ls failed: ${firstLine(listed.stderr)}`);
  }
  return projectsSchema
    .parse(JSON.parse(listed.stdout === '' ? '[]' : listed.stdout))
    .map((project) => project.Name)
    .filter((name) => name.startsWith(`${run}-`));
}

/** The ids of the resources of `kind` (`ps`, `network ls`, ...) that carry the labels of the run. */
async function idsOf(exec: Exec, list: readonly string[], run: string): Promise<string[]> {
  const result = await exec('docker', [...list, '--quiet', ...runFilters(run)]);
  if (result.code !== 0) {
    throw new ContainerError(`docker ${list.join(' ')} failed: ${firstLine(result.stderr)}`);
  }
  return result.stdout.split('\n').filter((id) => id !== '');
}

async function removeAll(exec: Exec, remove: readonly string[], ids: readonly string[]): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }
  const result = await exec('docker', [...remove, ...ids]);
  if (result.code !== 0) {
    throw new ContainerError(`docker ${remove.join(' ')} failed: ${firstLine(result.stderr)}`);
  }
  return ids.length;
}

/**
 * Removes the stacks of `run`. The run name is checked by the caller (names.ts): everything here is selected by that name and
 * by the two labels, so a resource of another run or of another repository is never touched. Idempotent: nothing left is
 * not an error, and a failure of one kind does not stop the next one (the first failure is thrown at the end).
 */
export async function removeRun(exec: Exec, run: string): Promise<Removed> {
  const projects = await projectsOf(exec, run);
  for (const project of projects) {
    await exec('docker', ['compose', '--project-name', project, 'down', '--volumes', '--remove-orphans']);
  }
  const kinds = [
    [
      ['ps', '--all'],
      ['rm', '--force', '--volumes'],
    ],
    [
      ['network', 'ls'],
      ['network', 'rm'],
    ],
    [
      ['volume', 'ls'],
      ['volume', 'rm', '--force'],
    ],
    [
      ['image', 'ls'],
      ['image', 'rm', '--force'],
    ],
  ] as const;
  const counts: number[] = [];
  const failures: string[] = [];
  for (const [list, remove] of kinds) {
    try {
      counts.push(await removeAll(exec, remove, await idsOf(exec, list, run)));
    } catch (error) {
      counts.push(0);
      failures.push(messageOf(error));
    }
  }
  if (failures.length > 0) {
    throw new ContainerError(failures.join('; '));
  }
  const [containers = 0, networks = 0, volumes = 0, images = 0] = counts;
  return { projects, containers, networks, volumes, images };
}
