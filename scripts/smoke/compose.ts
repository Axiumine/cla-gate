// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import type { ExecResult } from '../ci/lib/exec.ts';
import { readText } from './files.ts';
import type { StackNames } from './names.ts';
import type { Run, StackDeps } from './stack-types.ts';

// E19-S08: running `docker compose` for a smoke stack.

export const OVERRIDE_FILE = 'docker-compose.smoke.yml';
const LOG_LINES = 40;

/** The last lines of what a command printed: the reason comes last, and the rest is progress output. */
export function tail(result: ExecResult): string {
  return `${result.stderr}${result.stdout}`.trim().split('\n').slice(-LOG_LINES).join('\n');
}

/** The value of `secrets/<name>` with one trailing line break removed, as the application reads it. */
export function secretIn(directory: string, name: string): string {
  return readText(path.join(directory, 'secrets', name)).replace(/\r?\n$/, '');
}

/**
 * `docker compose` for the project: its name, its directory (where compose finds `.env`), the real file and the override.
 * `profiles` goes to COMPOSE_PROFILES and `environment` to the child, which outranks a variable of the same name in the shell.
 */
export function composer(deps: StackDeps, names: StackNames, directory: string) {
  const files = ['docker-compose.yml', OVERRIDE_FILE].flatMap((file) => ['--file', path.join(directory, file)]);
  return (profiles: string, environment: Readonly<Record<string, string>> = {}): Run =>
    (args) =>
      deps.exec(
        'docker',
        ['compose', '--project-name', names.project, '--project-directory', directory, ...files, ...args],
        { ...environment, COMPOSE_PROFILES: profiles },
      );
}
