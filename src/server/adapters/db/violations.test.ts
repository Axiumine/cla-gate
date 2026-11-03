// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { emptyTestDatabase } from './test-support.ts';
import { isUniqueViolation } from './violations.ts';

// What a driver reports for a unique violation, shown on the database of the run (PGlite or a real server) and on made-up errors.

test.each([
  ['the constraint it expects', { code: '23505', constraint: 'documents_name_key' }, 'documents_name_key', true],
  ['another unique constraint', { code: '23505', constraint: 'documents_pkey' }, 'documents_name_key', false],
  ['a unique violation that names no constraint', { code: '23505' }, 'documents_name_key', false],
  [
    'another SQLSTATE of the same constraint',
    { code: '23503', constraint: 'documents_name_key' },
    'documents_name_key',
    false,
  ],
  ['an error with no code', { constraint: 'documents_name_key' }, 'documents_name_key', false],
  [
    'an Error object of the right kind',
    Object.assign(new Error('duplicate'), { code: '23505', constraint: 'k' }),
    'k',
    true,
  ],
  ['text', 'duplicate key', 'k', false],
  ['nothing', undefined, 'k', false],
  ['null', null, 'k', false],
])('%s: %j is a unique violation of %j: %s', (_label, error, constraint, expected) => {
  expect(isUniqueViolation(error, constraint)).toBe(expected);
});

test('the error of the database for a duplicate row is read as a unique violation of that constraint and of no other', async () => {
  const { db } = await emptyTestDatabase();
  await sql`create table documents (id integer primary key, name text, constraint documents_name_key unique (name))`.execute(
    db,
  );
  await sql`insert into documents values (1, 'a')`.execute(db);
  const byName = await sql`insert into documents values (2, 'a')`.execute(db).catch((error: unknown) => error);
  const byKey = await sql`insert into documents values (1, 'b')`.execute(db).catch((error: unknown) => error);
  expect(isUniqueViolation(byName, 'documents_name_key')).toBe(true);
  expect(isUniqueViolation(byName, 'documents_pkey')).toBe(false);
  expect(isUniqueViolation(byKey, 'documents_pkey')).toBe(true);
  expect(isUniqueViolation(byKey, 'documents_name_key')).toBe(false);
});
