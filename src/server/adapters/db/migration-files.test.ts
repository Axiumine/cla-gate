// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { byName, loadMigrationFiles, MigrationError, toMigrationFile } from './migration-files.ts';
import { writeMigrationDirectory } from './test-support.ts';

test('a migration file carries the SHA-256 of its SQL', () => {
  const file = toMigrationFile('001_initial.sql', 'select 1;\n');
  expect(file).toEqual({
    name: '001_initial.sql',
    sql: 'select 1;\n',
    checksum: createHash('sha256').update('select 1;\n').digest('hex'),
  });
  expect(file.checksum).toMatch(/^[0-9a-f]{64}$/);
});

test('the checksum changes with a single byte', () => {
  expect(toMigrationFile('001_a.sql', 'select 1;').checksum).not.toBe(
    toMigrationFile('001_a.sql', 'select 1; ').checksum,
  );
});

test.each([
  ['1_initial.sql'],
  ['0001_initial.sql'],
  ['001-initial.sql'],
  ['001_Initial.sql'],
  ['001_.sql'],
  ['001_initial.SQL'],
  ['initial.sql'],
  ['001_initial.sql.bak'],
  ['../001_initial.sql'],
])('%s is not a valid migration name', (name) => {
  expect(() => toMigrationFile(name, 'select 1')).toThrow(MigrationError);
});

test('a migration problem is named MigrationError', () => {
  const error = new MigrationError('two migrations share the number 001');
  expect([error.name, error.message, error instanceof Error]).toEqual([
    'MigrationError',
    'two migrations share the number 001',
    true,
  ]);
});

test('byName orders by plain code point and never reports a difference for equal names', () => {
  const names = ['002_b.sql', '010_c.sql', '001_a.sql'].map((name) => ({ name }));
  expect(names.toSorted(byName).map((file) => file.name)).toEqual(['001_a.sql', '002_b.sql', '010_c.sql']);
  expect(byName({ name: '001_a.sql' }, { name: '001_a.sql' })).toBe(0);
});

test('files load in name order and other file types are ignored', async () => {
  const directory = await writeMigrationDirectory({
    '002_second.sql': 'select 2;',
    '001_first.sql': 'select 1;',
    'README.md': 'not a migration',
    '.gitkeep': '',
  });
  const files = await loadMigrationFiles(directory);
  expect(files.map((file) => [file.name, file.sql])).toEqual([
    ['001_first.sql', 'select 1;'],
    ['002_second.sql', 'select 2;'],
  ]);
});

test('an empty directory has no migrations', async () => {
  await expect(loadMigrationFiles(await writeMigrationDirectory({}))).resolves.toEqual([]);
});

test('a malformed .sql name fails the load', async () => {
  const directory = await writeMigrationDirectory({ 'add_users.sql': 'select 1;' });
  await expect(loadMigrationFiles(directory)).rejects.toThrow('invalid migration file name "add_users.sql"');
});

test('two migrations with the same number fail the load', async () => {
  const directory = await writeMigrationDirectory({ '001_a.sql': 'select 1;', '001_b.sql': 'select 2;' });
  await expect(loadMigrationFiles(directory)).rejects.toThrow('two migrations share the number 001');
});

test('a missing directory fails the load with the file system error', async () => {
  await expect(loadMigrationFiles('/nonexistent/cla-migrations')).rejects.toMatchObject({ code: 'ENOENT' });
});
