// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { symlink } from '../ci/lib/test-support.ts';
import { runScript, sandbox } from './test-support.ts';

// E19-S03: what the script does with its inputs before any SQL runs. The `psql` here is a stub, so these tests see the
// exit code and the messages of the script itself; the SQL is tested against a real server (provision-database.test.ts
// under src/server/adapters/db).

const GOOD = '0123456789abcdef-owner';
const OTHER = '0123456789abcdef-application';
const PASSWORDS = { CLA_OWNER_PASSWORD: GOOD, CLA_APP_PASSWORD: OTHER };
const NAME_RULE = '^[a-z_][a-z0-9_]{0,62}$';

function writeFile(directory: string, name: string, content: string | Buffer): string {
  const file = path.join(directory, name);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: a file inside the temp directory of the sandbox
  fs.writeFileSync(file, content);
  return file;
}

test.each([
  ['a quote and a statement', 'x"; drop database postgres; --'],
  ['an upper-case letter', 'Cla'],
  ['a leading digit', '1cla'],
  ['a hyphen', 'my-db'],
  ['a space', 'my db'],
  ['64 characters', 'a'.repeat(64)],
  ['a line break', 'good\nbad'],
])('CLA_DB_NAME with %s exits 2 before psql is started', (_name, value) => {
  const box = sandbox();
  const run = runScript(box, { ...PASSWORDS, CLA_DB_NAME: value });
  expect(run.status).toBe(2);
  expect(run.stderr).toBe(`provision-database: CLA_DB_NAME must match ${NAME_RULE}\n`);
  expect(box.psqlCalled()).toBe(false);
});

test.each([
  ['a quote and a statement', 'x"; drop role postgres; --'],
  ['an upper-case letter', 'Owner'],
  ['a hyphen', 'cla-owner'],
])('CLA_OWNER_ROLE with %s exits 2 before psql is started', (_name, value) => {
  const box = sandbox();
  const run = runScript(box, { ...PASSWORDS, CLA_OWNER_ROLE: value });
  expect(run.status).toBe(2);
  expect(run.stderr).toBe(`provision-database: CLA_OWNER_ROLE must match ${NAME_RULE}\n`);
  expect(box.psqlCalled()).toBe(false);
});

test('CLA_TEST_ROLE is held to the same rule', () => {
  const box = sandbox();
  const run = runScript(box, { ...PASSWORDS, CLA_TEST_ROLE: 'Dev Role', CLA_TEST_PASSWORD: GOOD });
  expect([run.status, run.stderr]).toEqual([2, `provision-database: CLA_TEST_ROLE must match ${NAME_RULE}\n`]);
  expect(box.psqlCalled()).toBe(false);
});

test.each([
  ['the shortest', 'a'],
  ['an underscore first', '_x9'],
  ['63 characters', 'a'.repeat(63)],
])('a name of %s is accepted and reaches psql unchanged', (_name, value) => {
  const box = sandbox();
  const run = runScript(box, { ...PASSWORDS, CLA_DB_NAME: value, CLA_OWNER_ROLE: value });
  expect(run.status).toBe(0);
  expect(box.seen().get('CLA_DB_NAME')).toBe(value);
  expect(box.seen().get('CLA_OWNER_ROLE')).toBe(value);
});

test('the defaults are cla and cla_owner', () => {
  const box = sandbox();
  expect(runScript(box, PASSWORDS).status).toBe(0);
  expect([box.seen().get('CLA_DB_NAME'), box.seen().get('CLA_OWNER_ROLE')]).toEqual(['cla', 'cla_owner']);
});

test.each([
  ['CLA_OWNER_PASSWORD', 15, 2],
  ['CLA_OWNER_PASSWORD', 16, 0],
  ['CLA_APP_PASSWORD', 15, 2],
  ['CLA_APP_PASSWORD', 16, 0],
])('%s of %i characters exits %i', (name, length, status) => {
  const box = sandbox();
  const run = runScript(box, { ...PASSWORDS, [name]: 'p'.repeat(length) });
  expect(run.status).toBe(status);
  expect(run.stderr).toBe(status === 0 ? '' : `provision-database: ${name} is shorter than 16 characters\n`);
  expect(box.psqlCalled()).toBe(status === 0);
});

test('CLA_TEST_PASSWORD is held to the same length', () => {
  const box = sandbox();
  const run = runScript(box, { ...PASSWORDS, CLA_TEST_ROLE: 'cla_dev', CLA_TEST_PASSWORD: 'short' });
  expect([run.status, run.stderr]).toEqual([
    2,
    'provision-database: CLA_TEST_PASSWORD is shorter than 16 characters\n',
  ]);
});

test('the development role is refused in production, before psql is started, and allowed elsewhere', () => {
  const box = sandbox();
  const production = runScript(box, {
    ...PASSWORDS,
    CLA_TEST_ROLE: 'cla_dev',
    CLA_TEST_PASSWORD: GOOD,
    NODE_ENV: 'production',
  });
  expect([production.status, production.stderr]).toEqual([
    2,
    'provision-database: CLA_TEST_ROLE is a development-only role and is refused when NODE_ENV=production\n',
  ]);
  expect(box.psqlCalled()).toBe(false);
  const development = runScript(box, {
    ...PASSWORDS,
    CLA_TEST_ROLE: 'cla_dev',
    CLA_TEST_PASSWORD: GOOD,
    NODE_ENV: 'development',
  });
  expect(development.status).toBe(0);
  expect(box.seen().get('CLA_TEST_ROLE')).toBe('cla_dev');
});

test('a test password without a test role is invalid input', () => {
  const box = sandbox();
  const run = runScript(box, { ...PASSWORDS, CLA_TEST_PASSWORD: GOOD });
  expect([run.status, run.stderr]).toEqual([2, 'provision-database: CLA_TEST_PASSWORD needs CLA_TEST_ROLE\n']);
});

test('a variable and its _FILE variant together are refused by name', () => {
  const box = sandbox();
  const file = writeFile(box.directory, 'owner', GOOD);
  const run = runScript(box, { ...PASSWORDS, CLA_OWNER_PASSWORD_FILE: file });
  expect([run.status, run.stderr]).toEqual([
    2,
    'provision-database: CLA_OWNER_PASSWORD, CLA_OWNER_PASSWORD_FILE: set only one\n',
  ]);
  expect(box.psqlCalled()).toBe(false);
});

test.each([
  ['a missing file', 'missing'],
  ['a directory', '.'],
])('%s as a _FILE is named, with its path, and never read', (_name, relative) => {
  const box = sandbox();
  const file = path.join(box.directory, relative);
  const run = runScript(box, { CLA_APP_PASSWORD: OTHER, CLA_OWNER_PASSWORD_FILE: file });
  expect([run.status, run.stderr]).toEqual([
    2,
    `provision-database: CLA_OWNER_PASSWORD_FILE: cannot read ${file} (not a readable file)\n`,
  ]);
});

test('a file over 64 KiB is refused and a file of exactly 64 KiB is read', () => {
  const box = sandbox();
  const big = writeFile(box.directory, 'big', 'p'.repeat(65_537));
  const refused = runScript(box, { CLA_APP_PASSWORD: OTHER, CLA_OWNER_PASSWORD_FILE: big });
  expect([refused.status, refused.stderr]).toEqual([
    2,
    'provision-database: CLA_OWNER_PASSWORD_FILE: file is larger than 64 KiB\n',
  ]);
  const limit = writeFile(box.directory, 'limit', 'p'.repeat(65_536));
  expect(runScript(box, { CLA_APP_PASSWORD: OTHER, CLA_OWNER_PASSWORD_FILE: limit }).status).toBe(0);
});

test.each([
  ['no newline', 'a-password-of-16+', 'a-password-of-16+'],
  ['one LF', 'a-password-of-16+\n', 'a-password-of-16+'],
  ['one CRLF', 'a-password-of-16+\r\n', 'a-password-of-16+'],
  ['two LF, of which one stays', 'a-password-of-16+\n\n', 'a-password-of-16+\n'],
  ['a lone CR, which stays', 'a-password-of-16+\r', 'a-password-of-16+\r'],
  ['spaces around, which stay', '  a-password-of-16+  \n', '  a-password-of-16+  '],
])('a file with %s gives the value exactly', (_name, content, expected) => {
  const box = sandbox();
  const file = writeFile(box.directory, 'value', content);
  const run = runScript(box, { CLA_APP_PASSWORD: OTHER, CLA_OWNER_PASSWORD_FILE: file });
  expect(run.status).toBe(0);
  expect(box.seen().get('CLA_OWNER_PASSWORD')).toBe(expected);
});

test.each([
  ['an empty file', ''],
  ['a file with only a newline', '\n'],
])('%s counts as unset: the password reaches psql as nothing', (_name, content) => {
  const box = sandbox();
  const file = writeFile(box.directory, 'empty', content);
  const run = runScript(box, { CLA_APP_PASSWORD: OTHER, CLA_OWNER_PASSWORD_FILE: file });
  expect(run.status).toBe(0);
  expect(box.seen().get('CLA_OWNER_PASSWORD')).toBeUndefined();
  expect(box.seen().get('CLA_APP_PASSWORD')).toBe(OTHER);
});

test('an empty variable counts as unset, and so does an empty _FILE variable', () => {
  const box = sandbox();
  const run = runScript(box, { CLA_OWNER_PASSWORD: '', CLA_OWNER_PASSWORD_FILE: '', CLA_APP_PASSWORD: OTHER });
  expect(run.status).toBe(0);
  expect(box.seen().get('CLA_OWNER_PASSWORD')).toBeUndefined();
});

test('every input can come from a file, a symlink to one included', () => {
  const box = sandbox();
  const real = writeFile(box.directory, 'real', 'my_db\n');
  const link = path.join(box.directory, 'link');
  symlink(real, link);
  const run = runScript(box, {
    ...PASSWORDS,
    CLA_DB_NAME_FILE: link,
    CLA_OWNER_ROLE_FILE: writeFile(box.directory, 'role', 'my_owner'),
    CLA_TEST_ROLE_FILE: writeFile(box.directory, 'test', 'my_dev\n'),
    CLA_TEST_PASSWORD_FILE: writeFile(box.directory, 'test-password', `${GOOD}\n`),
  });
  expect(run.status).toBe(0);
  expect(
    [...['CLA_DB_NAME', 'CLA_OWNER_ROLE', 'CLA_TEST_ROLE', 'CLA_TEST_PASSWORD']].map((n) => box.seen().get(n)),
  ).toEqual(['my_db', 'my_owner', 'my_dev', GOOD]);
});
