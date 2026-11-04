// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { type Run, runScript, type Sandbox, sandbox } from './test-support.ts';

// E19-S03: the admin password and the new role passwords travel only through the environment of the psql child. A run
// with made-up sentinel passwords must show them in none of stdout, stderr or the arguments of any process it starts.

const sentinel = (label: string): string => `sentinel-${label}-${randomBytes(9).toString('hex')}`;

interface Sentinels {
  readonly owner: string;
  readonly app: string;
  readonly test: string;
  readonly admin: string;
}

function sentinels(): Sentinels {
  return { owner: sentinel('owner'), app: sentinel('app'), test: sentinel('dev'), admin: sentinel('admin') };
}

function inputs(values: Sentinels): Record<string, string> {
  return {
    CLA_OWNER_PASSWORD: values.owner,
    CLA_APP_PASSWORD: values.app,
    CLA_TEST_ROLE: 'cla_dev',
    CLA_TEST_PASSWORD: values.test,
    PGPASSWORD: values.admin,
  };
}

function expectNoSentinel(values: Sentinels, box: Sandbox, run: Run): void {
  for (const value of [values.owner, values.app, values.test, values.admin]) {
    expect(run.stdout).not.toContain(value);
    expect(run.stderr).not.toContain(value);
    expect(box.commandLines()).not.toContain(value);
  }
}

test('the passwords reach the psql child through its environment and nowhere else', () => {
  const values = sentinels();
  const box = sandbox();
  const run = runScript(box, inputs(values));
  expect(run.status).toBe(0);
  const seen = box.seen();
  expect([
    seen.get('CLA_OWNER_PASSWORD'),
    seen.get('CLA_APP_PASSWORD'),
    seen.get('CLA_TEST_PASSWORD'),
    seen.get('PGPASSWORD'),
  ]).toEqual([values.owner, values.app, values.test, values.admin]);
  expectNoSentinel(values, box, run);
});

test('the passwords read from files are as hidden as the ones from the environment', () => {
  const values = sentinels();
  const box = sandbox();
  const files = Object.fromEntries(
    [
      ['CLA_OWNER_PASSWORD_FILE', values.owner],
      ['CLA_APP_PASSWORD_FILE', values.app],
      ['CLA_TEST_PASSWORD_FILE', values.test],
    ].map(([name = '', value = '']) => {
      const file = path.join(box.directory, name);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- test: a file inside the temp directory of the sandbox
      fs.writeFileSync(file, `${value}\n`);
      return [name, file];
    }),
  );
  const run = runScript(box, { ...files, CLA_TEST_ROLE: 'cla_dev', PGPASSWORD: values.admin });
  expect(run.status).toBe(0);
  expect(box.seen().get('CLA_APP_PASSWORD')).toBe(values.app);
  expectNoSentinel(values, box, run);
});

test.each([
  ['sh -x', ['sh', '-x']],
  ['bash -x', ['bash', '-x']],
  ['bash -o xtrace', ['bash', '-o', 'xtrace']],
])('tracing is switched off: a run under %s shows no password', (_name, shell) => {
  const values = sentinels();
  const box = sandbox();
  const run = runScript(box, inputs(values), { shell });
  expect(run.status).toBe(0);
  expectNoSentinel(values, box, run);
  expect(run.stderr).not.toContain('CLA_OWNER_PASSWORD');
});

test('a failing run is as quiet about the passwords as a successful one', () => {
  const values = sentinels();
  const box = sandbox({ status: 3, stderr: 'psql:<stdin>:1: ERROR:  something failed\n' });
  const run = runScript(box, inputs(values));
  expect([run.status, run.stderr]).toEqual([4, 'psql:<stdin>:1: ERROR:  something failed\n']);
  expectNoSentinel(values, box, run);
});

test('psql is started with fixed arguments only: no password, no name, no query, no variable assignment of a secret', () => {
  const box = sandbox();
  runScript(box, { ...inputs(sentinels()), CLA_DB_NAME: 'my_db' });
  const psql = box
    .commandLines()
    .split('\n')
    .filter((line) => line.startsWith('psql '));
  expect(psql).toEqual(['psql [-X] [-q] [-w] [-v] [ON_ERROR_STOP=1]']);
});

test('psql keeps no history and reads no startup file, and the SQL reaches it on standard input', () => {
  const box = sandbox();
  runScript(box, inputs(sentinels()));
  expect([box.seen().get('PSQL_HISTORY'), box.seen().get('PSQLRC')]).toEqual(['/dev/null', '/dev/null']);
  expect(box.stdin()).toBe(fs.readFileSync(path.resolve(import.meta.dirname, '../provision-database.sql'), 'utf8'));
});

test('the libpq variables of the administrator pass through and PGDATABASE defaults to postgres', () => {
  const box = sandbox();
  const libpq = { PGHOST: 'db.internal', PGPORT: '6543', PGUSER: 'admin', PGSSLMODE: 'verify-full' };
  runScript(box, { ...inputs(sentinels()), ...libpq });
  const seen = box.seen();
  expect([
    seen.get('PGHOST'),
    seen.get('PGPORT'),
    seen.get('PGUSER'),
    seen.get('PGSSLMODE'),
    seen.get('PGDATABASE'),
  ]).toEqual(['db.internal', '6543', 'admin', 'verify-full', 'postgres']);
  const other = sandbox();
  runScript(other, { ...inputs(sentinels()), PGDATABASE: 'template1' });
  expect(other.seen().get('PGDATABASE')).toBe('template1');
});
