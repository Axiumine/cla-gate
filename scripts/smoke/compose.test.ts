// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { expect, test } from 'vitest';
import { realExec } from '../ci/lib/exec.ts';
import { readText, writeExecutable } from '../ci/lib/test-support.ts';
import { tempDir } from '../code-caps/test-support.ts';
import { composer, scripter } from './compose.ts';
import { stackNames } from './names.ts';
import type { StackDeps } from './stack-types.ts';
import { callsOf, scripted } from './test-support.ts';

// E19-S12: `Stack.shell` runs a command line of the operator guides with `docker compose` meaning the stack. Here the real `sh`
// runs the scripts, with a `docker` and a `git` on the PATH that only write down what they were asked.

const NAMES = stackNames('cla-smoke-77-1', 'backup');
const CHECKOUT = '/work/checkout';

/** A directory with a `docker` and a `git` that append their arguments, one per line, preceded by a line naming the program. */
function fakes() {
  const bin = tempDir();
  const log = path.join(tempDir(), 'calls.log');
  for (const program of ['docker', 'git']) {
    writeExecutable(
      path.join(bin, program),
      `#!/bin/sh\n{ echo "== ${program} profiles=$COMPOSE_PROFILES port=$PORT"; for word in "$@"; do echo "$word"; done; } >> "${log}"\n`,
    );
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: a path inside a temporary directory the test made
  return { bin, calls: (): string[] => (fs.existsSync(log) ? readText(log).trim().split('\n') : []) };
}

/** `StackDeps` that run the real `sh`, for the checkout `CHECKOUT`. */
function realShell(): StackDeps {
  return { ...scripted().deps, exec: realExec, root: CHECKOUT };
}

/** The shell of a stack in a new directory, with the fakes first on the PATH. */
function shellIn(directory: string, bin: string, environment: Record<string, string> = {}) {
  const path_ = `${bin}:${process.env['PATH'] ?? ''}`;
  return scripter(realShell(), NAMES, directory)('tls', { PATH: path_, PORT: '41000', ...environment });
}

test('docker compose in a script is the compose of this stack: the same words composer() gives, then the rest of the line', async () => {
  const { bin, calls } = fakes();
  const directory = tempDir();
  const result = await shellIn(directory, bin)('docker compose exec -T postgres pg_dump -U cla_owner -Fc cla');
  expect(result.code, result.stderr).toBe(0);
  const { deps, calls: recorded } = scripted();
  await composer(deps, NAMES, directory)('tls')(['exec', '-T', 'postgres', 'pg_dump', '-U', 'cla_owner', '-Fc', 'cla']);
  const expected = callsOf(recorded, 'exec')[0]?.args ?? [];
  expect(calls()).toEqual(['== docker profiles=tls port=41000', ...expected]);
});

test('any other docker command goes to docker as it is', async () => {
  const { bin, calls } = fakes();
  await shellIn(tempDir(), bin)('docker volume ls --quiet');
  expect(calls()).toEqual(['== docker profiles=tls port=41000', 'volume', 'ls', '--quiet']);
});

test('docker with no argument at all is docker with no argument', async () => {
  const { bin, calls } = fakes();
  await shellIn(tempDir(), bin)('docker');
  expect(calls()).toEqual(['== docker profiles=tls port=41000']);
});

test('git asks the checkout the stack was built from, whatever directory the script runs in', async () => {
  const { bin, calls } = fakes();
  const result = await shellIn(tempDir(), bin)('SOURCE_COMMIT=$(git rev-parse HEAD) docker compose up -d');
  expect(result.code, result.stderr).toBe(0);
  expect(calls().slice(0, 4)).toEqual(['== git profiles=tls port=41000', '-C', CHECKOUT, 'rev-parse']);
});

test('the script runs in the work directory of the stack, which it creates, with files private to the owner', async () => {
  const { bin } = fakes();
  const directory = tempDir();
  const result = await shellIn(directory, bin)('pwd; echo dumped > cla.dump; cat < cla.dump');
  expect(result.stdout.split('\n').slice(0, 2)).toEqual([path.join(directory, 'work'), 'dumped']);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: a path inside a temporary directory the test made
  expect(fs.statSync(path.join(directory, 'work', 'cla.dump')).mode & 0o777).toBe(0o600);
});

test('the first line that fails ends the script, and an unset variable is a failure', async () => {
  const { bin } = fakes();
  const stopped = await shellIn(tempDir(), bin)('echo before; false; echo after');
  expect([stopped.code, stopped.stdout.trim()]).toEqual([1, 'before']);
  const unset = await shellIn(tempDir(), bin)('echo "$CLA_NOT_SET"; echo after');
  expect(unset.code).not.toBe(0);
  expect(unset.stdout).not.toContain('after');
});

test('the settings of the stack reach the script, and so do the name of the project, the directory and the checkout', async () => {
  const { bin } = fakes();
  const directory = tempDir();
  const result = await shellIn(directory, bin, { CADDY_HTTPS_PORT: '42000' })(
    'echo "$CADDY_HTTPS_PORT $CLA_SMOKE_PROJECT $CLA_SMOKE_DIRECTORY $CLA_SMOKE_ROOT"',
  );
  expect(result.stdout.trim()).toBe(`42000 ${NAMES.project} ${directory} ${CHECKOUT}`);
});

test('without settings the script still runs, with the profile alone', async () => {
  const { deps } = scripted();
  const result = await scripter({ ...deps, exec: realExec }, NAMES, tempDir())('')('echo "[$COMPOSE_PROFILES]"');
  expect(result.stdout.trim()).toBe('[]');
});
