// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { expect, test } from 'vitest';
import { findOnPath, readText } from '../ci/lib/test-support.ts';
import { SCRIPT, SQL_FILE } from './test-support.ts';

// E19-S03: properties of the two files that no run shows: the executable bit, tracing off, and what the SQL may and may not
// contain. The behaviour is tested in the files next to this one and, on a real server, in provision-database.test.ts.

const script = readText(SCRIPT);
const sqlText = readText(SQL_FILE);
/** The SQL a server receives: no comment and no message for a person (`\warn` lines). */
const statements = sqlText
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--') && !line.trimStart().startsWith('\\warn'));

test('the script is executable, POSIX sh, licensed, and switches tracing off before anything else', () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test: the fixed path of the script in this repository
  expect(fs.statSync(SCRIPT).mode & 0o111).toBe(0o111);
  const lines = script.split('\n');
  expect(lines.slice(0, 3)).toEqual([
    '#!/bin/sh',
    '# SPDX-License-Identifier: AGPL-3.0-only',
    '# Copyright (C) 2026 Giovanni Manzoni',
  ]);
  const first = lines.find((line) => line !== '' && !line.startsWith('#'));
  expect(first).toBe('set +x');
});

test('the script parses as POSIX sh', () => {
  const result = spawnSync(findOnPath('sh'), ['-n', SCRIPT], { encoding: 'utf8' });
  expect([result.status, result.stderr]).toEqual([0, '']);
});

test('the script keeps psql from a history and from startup files, and never passes a variable on the command line', () => {
  expect(script).toContain('PSQL_HISTORY=/dev/null');
  expect(script).toContain('PSQLRC=/dev/null');
  expect(script).toContain('psql -X -q -w -v ON_ERROR_STOP=1 <"$sql_file"');
  expect([...script.matchAll(/\bpsql\b[^\n]*-v\s/g)].map((match) => match[0].trim())).toEqual(['psql -X -q -w -v']);
  expect(script).not.toMatch(/\bpsql\b[^\n]*(?:-c\b|--command|-W\b|--password)/);
});

test('the SQL file starts with the licence and reads every input with \\getenv, the passwords included', () => {
  expect(sqlText.split('\n').slice(0, 2)).toEqual([
    '-- SPDX-License-Identifier: AGPL-3.0-only',
    '-- Copyright (C) 2026 Giovanni Manzoni',
  ]);
  const read = [...sqlText.matchAll(/^\\getenv (\w+) (\w+)$/gm)].map((match) => `${match[1]} ${match[2]}`);
  expect(read).toEqual([
    'db CLA_DB_NAME',
    'owner CLA_OWNER_ROLE',
    'test_role CLA_TEST_ROLE',
    'owner_password CLA_OWNER_PASSWORD',
    'app_password CLA_APP_PASSWORD',
    'test_password CLA_TEST_PASSWORD',
    'node_env NODE_ENV',
  ]);
  for (const name of [
    'CLA_DB_NAME',
    'CLA_OWNER_ROLE',
    'CLA_TEST_ROLE',
    'CLA_OWNER_PASSWORD',
    'CLA_APP_PASSWORD',
    'CLA_TEST_PASSWORD',
  ]) {
    expect(script).toContain(`resolve ${name} `);
  }
});

test('a password is never printed, written or sent anywhere but into ALTER ROLE', () => {
  const uses = statements.filter((line) => /:'(?:owner|app|test)_password'/.test(line));
  expect(uses.length).toBeGreaterThan(6);
  for (const line of uses) {
    expect(line).toMatch(/alter role %I password %L|char_length|<> ''|= ''/);
  }
  const printed = sqlText.split('\n').filter((line) => /\\(?:echo|warn|qecho)\b/.test(line));
  expect(printed.filter((line) => /:["']?(?:owner|app|test)_password\b/.test(line))).toEqual([]);
  expect(statements.filter((line) => /\\(?:o|w|i|ir|copy|!|password|set\s+ECHO)\b/.test(line))).toEqual([]);
});

test('every identifier reaches SQL through format(%I): no :"x" interpolation, no concatenation, no dynamic DDL outside format', () => {
  expect(statements.filter((line) => line.includes(':"') || line.includes('||'))).toEqual([]);
  const names = /:'(?:db|owner|app|test_role|pgboss_owner)'/;
  const ddl = /^\s*(?:create|alter|grant|revoke)\b/i;
  const bare = statements.filter((line) => names.test(line) && ddl.test(line) && !line.includes('format('));
  expect(bare).toEqual([]);
  const formats = statements.filter((line) => line.includes('format('));
  expect(formats.length).toBeGreaterThan(15);
  for (const line of formats) {
    expect(line).toMatch(/format\('[^']*'/);
  }
});

test('the SQL drops nothing and sets default privileges only for the pgboss schema', () => {
  expect(statements.filter((line) => /\bdrop\b/i.test(line))).toEqual([]);
  expect(statements.filter((line) => /\btruncate\b|\bdelete\s+from\b|\breassign\b/i.test(line))).toEqual([]);
  const defaults = statements.filter((line) => /alter default privileges/i.test(line));
  expect(defaults).toHaveLength(3);
  for (const line of defaults) {
    expect(line).toContain('in schema pgboss');
    expect(line).toContain('for role %I');
  }
});

test('every refusal prints a prefix the script maps to an exit code, and then fails', () => {
  const refusals = sqlText.split('\n').filter((line) => line.trimStart().startsWith('\\warn'));
  expect(refusals.length).toBeGreaterThan(10);
  for (const line of refusals) {
    expect(line).toMatch(/^\s*\\warn provision-database: (?:invalid|conflict): /);
  }
  const raises = statements.filter((line) => line.includes('raise exception'));
  expect(raises).toHaveLength(refusals.length);
  expect(script).toContain("*'provision-database: conflict: '*) exit 3");
  expect(script).toContain('*\'provision-database: invalid: \'*) exit "$EXIT_INPUT"');
});
