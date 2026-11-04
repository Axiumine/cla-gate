// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import type { ExecResult } from '../ci/lib/exec.ts';
import { readText } from './files.ts';
import type { StackNames } from './names.ts';
import type { Run, RunScript, StackDeps } from './stack-types.ts';

// E19-S08: running `docker compose` for a smoke stack.

export const OVERRIDE_FILE = 'docker-compose.smoke.yml';
/** The files of every `docker compose` call of a stack, in the order compose merges them: the real file, then the override. */
const COMPOSE_FILES = ['docker-compose.yml', OVERRIDE_FILE] as const;
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
 * `docker compose` for the project: its name, its directory (where compose finds the dotenv file), the real file and the
 * override. `profiles` goes to COMPOSE_PROFILES and `environment` to the child, which outranks a variable of the same name in
 * the shell.
 */
export function composer(deps: StackDeps, names: StackNames, directory: string) {
  const files = COMPOSE_FILES.flatMap((file) => ['--file', path.join(directory, file)]);
  return (profiles: string, environment: Readonly<Record<string, string>> = {}): Run =>
    (args) =>
      deps.exec(
        'docker',
        ['compose', '--project-name', names.project, '--project-directory', directory, ...files, ...args],
        { ...environment, COMPOSE_PROFILES: profiles },
      );
}

/** What a script starts with: the work directory, and `docker compose` and `git` as functions bound to this stack. */
function preamble(): string {
  const files = COMPOSE_FILES.map((file) => `--file "$CLA_SMOKE_DIRECTORY/${file}"`).join(' ');
  return [
    'set -eu',
    'umask 077',
    'mkdir -p "$CLA_SMOKE_DIRECTORY/work"',
    'cd "$CLA_SMOKE_DIRECTORY/work"',
    // A function named like the program: `docker compose ...` in the script runs against this project, anything else is docker.
    'docker() {',
    '  if [ "$#" -eq 0 ] || [ "$1" != compose ]; then command docker "$@"; return; fi',
    '  shift',
    `  command docker compose --project-name "$CLA_SMOKE_PROJECT" --project-directory "$CLA_SMOKE_DIRECTORY" ${files} "$@"`,
    '}',
    // The directory the script runs in is not a checkout, so `git rev-parse HEAD` asks the one the stack was built from.
    'git() { command git -C "$CLA_SMOKE_ROOT" "$@"; }',
  ].join('\n');
}

/**
 * Runs a script of shell with `sh -c` (E19-S12). The operator guides print command lines such as
 * `docker compose exec -T postgres pg_dump ... > cla.dump`; a scenario that must run exactly those lines needs a shell for the
 * redirections and a `docker compose` that means this stack. Same `profiles` and `environment` as {@link composer}.
 */
export function scripter(deps: StackDeps, names: StackNames, directory: string) {
  return (profiles: string, environment: Readonly<Record<string, string>> = {}): RunScript =>
    (script) =>
      deps.exec('sh', ['-c', `${preamble()}\n${script}`], {
        ...environment,
        COMPOSE_PROFILES: profiles,
        CLA_SMOKE_PROJECT: names.project,
        CLA_SMOKE_DIRECTORY: directory,
        CLA_SMOKE_ROOT: deps.root,
      });
}
