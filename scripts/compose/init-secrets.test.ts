// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { exists, readText, symlink } from '../ci/lib/test-support.ts';
import { makeRepo } from '../code-caps/test-support.ts';
import {
  byName,
  checkout,
  DERIVED,
  fingerprint,
  GENERATED,
  INIT_SCRIPT,
  linkTarget,
  makeDirectory,
  modeOf,
  PLACEHOLDERS,
  ROOT,
  setMode,
} from './test-support.ts';

// E19-S04: scripts/init-secrets.sh creates what the operator stack mounts, once, and never touches what exists. Each test runs
// the real script with `sh` in a scratch checkout (a copy of the script and of the example environment file in a temporary
// directory). The randomness fallbacks are in init-secrets-random.test.ts.

const ALL = [...GENERATED, ...DERIVED, ...PLACEHOLDERS];
const ENV_FILE = '.env';
const ENV_EXAMPLE = '.env.example';
/** Named apart from the calls that use them: a first argument that spells the word of a credential trips a Semgrep rule (node_secret) however plain the file name is. */
const SESSION_FILE = 'session_secret';
const CLIENT_FILE = 'github_client_secret';
const NOTHING = 'nothing to do: every secret file and .env exist already';

/** Every file the script may have created, as `name: fingerprint` lines. */
function snapshot(box: ReturnType<typeof checkout>): string[] {
  return [...ALL.map((name) => path.join(box.files, name)), path.join(box.root, ENV_FILE)].map(
    (file) => `${path.basename(file)}: ${fingerprint(file)}`,
  );
}

test('the script is executable POSIX sh with the licence header, and switches tracing off before anything else', () => {
  const text = readText(INIT_SCRIPT);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test: the fixed path of the script in this repository
  expect(fs.statSync(INIT_SCRIPT).mode & 0o111).toBe(0o111);
  expect(text.split('\n').slice(0, 3)).toEqual([
    '#!/bin/sh',
    '# SPDX-License-Identifier: AGPL-3.0-only',
    '# Copyright (C) 2026 Giovanni Manzoni',
  ]);
  expect(text.split('\n').find((line) => line !== '' && !line.startsWith('#'))).toBe('set +x');
});

test('a first run creates secrets/ with mode 0700 and every file once, with mode 0444', () => {
  const box = checkout();
  expect(box.listing()).toEqual([]);
  const run = box.run();
  expect([run.status, run.stderr]).toEqual([0, '']);
  expect(modeOf(box.files)).toBe('700');
  expect(box.listing().toSorted(byName)).toEqual([...ALL].toSorted(byName));
  expect(ALL.map((name) => [name, modeOf(path.join(box.files, name))])).toEqual(ALL.map((name) => [name, '444']));
});

test('the five generated secrets are 64 hexadecimal characters each and all different', () => {
  const box = checkout();
  box.run();
  const values = GENERATED.map((name) => box.read(name));
  expect(values.map((value) => /^[0-9a-f]{64}\n$/.test(value))).toEqual(GENERATED.map(() => true));
  expect(new Set(values).size).toBe(GENERATED.length);
});

test('the placeholders are empty files, so that the first-run setup has something to mount', () => {
  const box = checkout();
  box.run();
  expect(PLACEHOLDERS.map((name) => box.read(name))).toEqual(PLACEHOLDERS.map(() => ''));
});

test('database_url and migration_database_url carry the passwords of the two role files', () => {
  const box = checkout();
  box.run();
  const app = box.read('db_app_password').trim();
  const owner = box.read('db_owner_password').trim();
  expect(box.read('database_url')).toBe(`postgres://cla_app:${app}@postgres:5432/cla\n`);
  expect(box.read('migration_database_url')).toBe(`postgres://cla_owner:${owner}@postgres:5432/cla\n`);
});

test('a second run changes no file: contents, modes, modification times and inodes are the same', () => {
  const box = checkout();
  box.run();
  const before = snapshot(box);
  const again = box.run();
  expect(snapshot(box)).toEqual(before);
  expect([again.status, again.stdout.split('\n')[0], again.stderr]).toEqual([0, NOTHING, '']);
});

test('the first run names the files it created, and says where the setup token is', () => {
  const box = checkout();
  const run = box.run();
  expect(run.stdout.split('\n')).toEqual([
    ...ALL.map((name) => `created secrets/${name}`),
    `created ${ENV_FILE}`,
    'The setup token that unlocks /setup is in secrets/setup_token.',
    '',
  ]);
});

test('no generated value is printed, with or without shell tracing', () => {
  const box = checkout();
  const traced = box.run({ shell: ['sh', '-x'] });
  const values = [...GENERATED, ...DERIVED].map((name) => box.read(name).trim());
  const printed = `${traced.stdout}\n${traced.stderr}`;
  expect(values.filter((value) => printed.includes(value))).toEqual([]);
  expect(traced.status).toBe(0);
  const second = box.run({ shell: ['sh', '-x'] });
  expect(values.filter((value) => `${second.stdout}${second.stderr}`.includes(value))).toEqual([]);
});

test('a file that exists is never overwritten, and the missing ones around it are created', () => {
  const box = checkout();
  box.write(SESSION_FILE, 'chosen-by-the-operator\n');
  box.write('database_url', 'postgres://custom\n');
  box.write(CLIENT_FILE, 'already-saved\n');
  const run = box.run();
  expect(run.status).toBe(0);
  expect([box.read(SESSION_FILE), box.read('database_url'), box.read(CLIENT_FILE)]).toEqual([
    'chosen-by-the-operator\n',
    'postgres://custom\n',
    'already-saved\n',
  ]);
  expect(run.stdout).not.toContain('created secrets/session_secret');
  expect(run.stdout).not.toContain('created secrets/database_url');
  expect(run.stdout).toContain('created secrets/setup_token');
  expect(run.stdout).toContain('created secrets/migration_database_url');
});

test('a password written by the operator is what the derived URL carries, and an existing directory keeps its mode', () => {
  const box = checkout();
  box.write('db_app_password', 'Operator.chosen-password_1~\n');
  setMode(box.files, 0o750);
  box.run();
  expect(box.read('database_url')).toBe('postgres://cla_app:Operator.chosen-password_1~@postgres:5432/cla\n');
  expect(modeOf(box.files)).toBe('750');
});

test('a dangling link where a file belongs is left alone, not followed', () => {
  const box = checkout();
  makeDirectory(box.files);
  const target = path.join(box.root, 'elsewhere');
  symlink(target, path.join(box.files, 'setup_token'));
  const run = box.run();
  expect(run.status).toBe(0);
  expect([exists(target), linkTarget(path.join(box.files, 'setup_token'))]).toEqual([false, target]);
});

test.each([
  ['unsafe', 'p@ss/word:1\n', /^init-secrets: secrets\/db_app_password has characters that a URL cannot carry/],
  ['empty', '', /^init-secrets: secrets\/db_app_password is empty/],
])('a %s password cannot go into a URL: the run stops, names the file, prints no value', (_kind, text, rule) => {
  const box = checkout();
  box.write('db_app_password', text);
  const run = box.run();
  expect([run.status, run.stdout]).toEqual([1, '']);
  expect(run.stderr).toMatch(rule);
  expect(run.stderr).not.toContain('p@ss');
  expect(exists(path.join(box.files, 'database_url'))).toBe(false);
});

test('an unsafe owner password stops the run the same way', () => {
  const box = checkout();
  box.write('db_owner_password', 'has space in it\n');
  const run = box.run();
  expect([run.status, run.stderr.startsWith('init-secrets: secrets/db_owner_password has characters ')]).toEqual([
    1,
    true,
  ]);
  expect(exists(path.join(box.files, 'migration_database_url'))).toBe(false);
});

test('.env is a copy of the example and a .env that exists is kept', () => {
  const box = checkout();
  box.run();
  expect(readText(path.join(box.root, ENV_FILE))).toBe(readText(path.join(ROOT, ENV_EXAMPLE)));
  makeRepo(box.root, { [ENV_FILE]: 'PUBLIC_BASE_URL=https://cla.example.com\n' });
  const run = box.run();
  expect(run.stdout.split('\n')[0]).toBe(NOTHING);
  expect(readText(path.join(box.root, ENV_FILE))).toBe('PUBLIC_BASE_URL=https://cla.example.com\n');
});

test('without the example file the run stops after the secrets, naming the missing file', () => {
  const box = checkout();
  fs.rmSync(path.join(box.root, ENV_EXAMPLE));
  const run = box.run();
  expect([run.status, run.stderr]).toEqual([1, `init-secrets: cannot read ${box.root}/${ENV_EXAMPLE}\n`]);
  expect(exists(path.join(box.root, ENV_FILE))).toBe(false);
});

test('a secrets path that is a file stops the run before anything is created', () => {
  const box = checkout();
  makeRepo(box.root, { secrets: 'not a directory' });
  const run = box.run();
  expect([run.status, run.stderr]).toEqual([1, `init-secrets: ${box.files} exists and is not a directory\n`]);
  expect(exists(path.join(box.root, ENV_FILE))).toBe(false);
});

test('the script works on the checkout it lives in, from any directory', () => {
  const box = checkout();
  const run = box.run();
  expect(run.status).toBe(0);
  expect(exists(path.join(box.files, 'setup_token'))).toBe(true);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test: the scratch directory the script was started in
  expect(fs.readdirSync(box.outside)).toEqual([]);
});
