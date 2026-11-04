// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { runScript, sandbox } from './test-support.ts';

// E19-S03: what the script does around psql: the client check, the exit codes, the output. `psql` is a stub.

const PASSWORDS = { CLA_OWNER_PASSWORD: '0123456789abcdef-owner', CLA_APP_PASSWORD: '0123456789abcdef-application' };
const CONFLICT = 'provision-database: conflict: refusing to change the owner of an existing database\n';
const INVALID = 'provision-database: invalid: role cla_owner does not exist and no password was given\n';

test.each([
  ['done', { status: 0 }, 0],
  ['a conflict reported by the SQL file', { status: 3, stderr: CONFLICT }, 3],
  ['invalid input reported by the SQL file', { status: 3, stderr: INVALID }, 2],
  ['an SQL error without a prefix', { status: 3, stderr: 'psql:<stdin>:9: ERROR:  permission denied\n' }, 4],
  ['no connection', { status: 2, stderr: 'psql: error: connection to server failed\n' }, 4],
  ['a conflict line in the middle of other messages', { status: 3, stderr: `x\n${CONFLICT}y\n` }, 3],
])('psql reports %s: the exit code is %i', (_name, fake, expected) => {
  const run = runScript(sandbox(fake), PASSWORDS);
  expect(run.status).toBe(expected);
});

test('psql output is passed on as it is and its messages are printed on stderr', () => {
  const stdout = 'role cla_owner: created\nrole cla_app: created\n';
  const run = runScript(sandbox({ stdout, stderr: CONFLICT, status: 3 }), PASSWORDS);
  expect(run.stdout).toBe(stdout);
  expect(run.stderr).toBe(CONFLICT);
});

test('a refusal does not print the connection strings', () => {
  const run = runScript(sandbox({ status: 3, stderr: CONFLICT }), PASSWORDS);
  expect(run.stdout).not.toContain('DATABASE_URL');
});

test('a successful run ends with the connection string templates and the percent-encoding reminder', () => {
  const run = runScript(sandbox({ stdout: 'role cla_owner: created\n' }), PASSWORDS);
  expect(run.stdout).toBe(
    [
      'role cla_owner: created',
      '',
      'The application takes these connection strings; replace <password> with the password of the role and',
      'percent-encode special characters in it (for example @ as %40 and / as %2F):',
      '  DATABASE_URL=postgres://cla_app:<password>@HOST:PORT/cla',
      '  MIGRATION_DATABASE_URL=postgres://cla_owner:<password>@HOST:PORT/cla',
      '',
    ].join('\n'),
  );
});

test('the templates name the database and the owner role that were asked for, and the runtime role stays cla_app', () => {
  const run = runScript(sandbox(), { ...PASSWORDS, CLA_DB_NAME: 'claim', CLA_OWNER_ROLE: 'claim_owner' });
  expect(run.stdout).toContain('  DATABASE_URL=postgres://cla_app:<password>@HOST:PORT/claim\n');
  expect(run.stdout).toContain('  MIGRATION_DATABASE_URL=postgres://claim_owner:<password>@HOST:PORT/claim\n');
});

test('without psql the script says what to install and exits 4', () => {
  const box = sandbox({ absent: true });
  const run = runScript(box, PASSWORDS);
  expect([run.status, run.stderr]).toEqual([
    4,
    'provision-database: psql was not found: install the PostgreSQL client, version 15 or later\n',
  ]);
});

test.each([
  ['14.13 (Debian 14.13-1)', 4],
  ['15.0', 0],
  ['15beta1', 0],
  ['9.6.24', 4],
  ['not a version', 4],
])('psql %s: exit %i', (version, expected) => {
  const box = sandbox({ version });
  const run = runScript(box, PASSWORDS);
  expect(run.status).toBe(expected);
  expect(box.psqlCalled()).toBe(expected === 0);
  expect(run.stderr).toBe(
    expected === 0
      ? ''
      : 'provision-database: psql 15 or later is needed (the SQL file reads its inputs with \\getenv)\n',
  );
});

test('the script is POSIX sh: it also runs under bash in POSIX mode and in dash through `sh`', () => {
  const box = sandbox();
  const run = runScript(box, PASSWORDS, { shell: ['bash', '--posix'] });
  expect(run.status).toBe(0);
  expect(runScript(sandbox(), PASSWORDS, { shell: ['sh'] }).status).toBe(0);
});
