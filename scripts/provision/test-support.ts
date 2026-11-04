// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { exists, findOnPath, readText, writeExecutable } from '../ci/lib/test-support.ts';
import { tempDir } from '../code-caps/test-support.ts';

// What the tests of scripts/provision-database.sh (E19-S03) run it with: a directory of stub tools in front of the real
// ones. The stub `psql` records how it was called (arguments, environment, standard input) and answers as the test says;
// the other tools the script runs record their arguments and then run for real, so that a test can look at every
// process the script started.

const ROOT = path.resolve(import.meta.dirname, '../..');
export const SCRIPT = path.join(ROOT, 'scripts/provision-database.sh');
export const SQL_FILE = path.join(ROOT, 'scripts/provision-database.sql');

/** The environment variables the stub `psql` reports on: a file `env-NAME` with the value, absent when the variable is unset. */
const REPORTED = [
  'CLA_DB_NAME',
  'CLA_OWNER_ROLE',
  'CLA_TEST_ROLE',
  'CLA_OWNER_PASSWORD',
  'CLA_APP_PASSWORD',
  'CLA_TEST_PASSWORD',
  'CLA_OWNER_PASSWORD_FILE',
  'PGHOST',
  'PGPORT',
  'PGUSER',
  'PGDATABASE',
  'PGPASSWORD',
  'PGSSLMODE',
  'PSQL_HISTORY',
  'PSQLRC',
] as const;

/** Tools the script starts besides `psql`; each is wrapped so that its arguments are recorded. */
const WATCHED = ['sed', 'tr', 'wc', 'cat', 'dirname', 'stty', 'printenv'] as const;

export interface FakePsql {
  /** What `psql --version` prints after `psql (PostgreSQL) `; defaults to a current release. */
  readonly version?: string;
  /** No `psql` on the PATH at all. */
  readonly absent?: boolean;
  readonly status?: number;
  readonly stdout?: string;
  readonly stderr?: string;
}

export interface Sandbox {
  readonly directory: string;
  readonly bin: string;
  /** The recorded command lines of every process: `tool [argument] [argument]` per line. */
  readonly commandLines: () => string;
  /** The standard input the stub `psql` was given: the SQL file. */
  readonly stdin: () => string;
  /** What the stub `psql` saw in its environment, by name; an unset variable is `undefined`. */
  readonly seen: () => ReadonlyMap<string, string | undefined>;
  readonly psqlCalled: () => boolean;
  /** Environment that points the stub tools at their log directory. */
  readonly env: Readonly<Record<string, string>>;
}

function fakePsqlSource(): string {
  return [
    '#!/bin/sh',
    'if [ "$1" = --version ]; then',
    '  echo "psql (PostgreSQL) $FAKE_PSQL_VERSION"',
    '  exit 0',
    'fi',
    '{ printf psql; for argument in "$@"; do printf " [%s]" "$argument"; done; echo; } >>"$FAKE_LOG/commands"',
    'cat >"$FAKE_LOG/stdin"',
    `for name in ${REPORTED.join(' ')}; do`,
    '  if printenv "$name" >/dev/null; then',
    '    printenv "$name" >"$FAKE_LOG/env-$name"',
    '  fi',
    'done',
    'printf "%s" "$FAKE_PSQL_STDOUT"',
    'printf "%s" "$FAKE_PSQL_STDERR" >&2',
    'exit "$FAKE_PSQL_STATUS"',
    '',
  ].join('\n');
}

function watcherSource(tool: string): string {
  const real = findOnPath(tool);
  return [
    '#!/bin/sh',
    `{ printf ${tool}; for argument in "$@"; do printf " [%s]" "$argument"; done; echo; } >>"$FAKE_LOG/commands"`,
    `exec ${real} "$@"`,
    '',
  ].join('\n');
}

/** A fresh sandbox of stub tools, removed after the current test. */
export function sandbox(fake: FakePsql = {}): Sandbox {
  const directory = tempDir();
  const bin = path.join(directory, 'bin');
  const log = path.join(directory, 'log');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: inside the temp directory of the sandbox
  fs.mkdirSync(bin);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: inside the temp directory of the sandbox
  fs.mkdirSync(log);
  if (fake.absent !== true) {
    writeExecutable(path.join(bin, 'psql'), fakePsqlSource());
  }
  for (const tool of WATCHED) {
    writeExecutable(path.join(bin, tool), watcherSource(tool));
  }
  const logFile = (name: string): string => path.join(log, name);
  // Both exist from the start, so that a run that never reached psql reads as empty.
  for (const name of ['commands', 'stdin']) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: inside the temp directory of the sandbox
    fs.writeFileSync(logFile(name), '');
  }
  const read = (name: string): string => readText(logFile(name));
  return {
    directory,
    bin,
    commandLines: () => read('commands'),
    stdin: () => read('stdin'),
    // printenv ends the value with one newline, which is not part of it.
    seen: () =>
      new Map(
        REPORTED.map((name) => [name, exists(logFile(`env-${name}`)) ? read(`env-${name}`).slice(0, -1) : undefined]),
      ),
    psqlCalled: () =>
      read('commands')
        .split('\n')
        .some((line) => line.startsWith('psql ')),
    env: {
      FAKE_LOG: log,
      FAKE_PSQL_VERSION: fake.version ?? '18.6 (Debian 18.6-1.pgdg13+2)',
      FAKE_PSQL_STATUS: String(fake.status ?? 0),
      FAKE_PSQL_STDOUT: fake.stdout ?? '',
      FAKE_PSQL_STDERR: fake.stderr ?? '',
    },
  };
}

export interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** The environment of a run: the stubs are the only tools on the PATH (a real `psql` must not be found), nothing is inherited. */
function environmentOf(box: Sandbox, extra: Readonly<Record<string, string>>): Record<string, string> {
  return { PATH: box.bin, HOME: box.directory, LC_ALL: 'C', ...box.env, ...extra };
}

export interface RunOptions {
  /** Interpreter and its flags, such as `['sh', '-x']`; the default is `sh`. */
  readonly shell?: readonly string[];
}

/** Runs the script without a terminal (standard input is a pipe). */
export function runScript(box: Sandbox, extra: Readonly<Record<string, string>> = {}, options: RunOptions = {}): Run {
  const [shell = 'sh', ...flags] = options.shell ?? [];
  const result = spawnSync(findOnPath(shell), [...flags, SCRIPT], {
    env: environmentOf(box, extra),
    input: '',
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

export interface Answer {
  /** Text the terminal shows before the answer is typed. */
  readonly after: string;
  readonly text: string;
}

export interface TerminalRun {
  readonly status: number | null;
  /** Everything the terminal showed: the echo of typed characters would be in it. */
  readonly screen: string;
}

/**
 * Runs the script on a pseudo-terminal (`script` of util-linux), typing each answer when its prompt has appeared. The
 * script turns echo off before it prints a prompt, so an answer typed at once is not shown.
 */
export function runOnTerminal(
  box: Sandbox,
  answers: readonly Answer[],
  extra: Readonly<Record<string, string>> = {},
): Promise<TerminalRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(findOnPath('script'), ['-qefc', `${findOnPath('sh')} ${SCRIPT}`, '/dev/null'], {
      env: environmentOf(box, extra),
    });
    const queue = [...answers];
    let screen = '';
    let shown = 0;
    child.stdout.on('data', (chunk: Buffer) => {
      screen += chunk.toString('utf8');
      const next = queue[0];
      const at = next === undefined ? -1 : screen.indexOf(next.after, shown);
      if (next !== undefined && at !== -1) {
        shown = at + next.after.length;
        queue.shift();
        child.stdin.write(`${next.text}\n`);
      }
    });
    child.on('error', reject);
    child.on('close', (status) => {
      resolve({ status, screen });
    });
  });
}
