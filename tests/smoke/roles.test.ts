// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { output, sqlAs } from '../../scripts/smoke/probe.ts';
import { stack } from './support.ts';

// E19-S08, role separation on the database that scripts/provision-database.sh made: the runtime role cla_app can read the
// signature tables but cannot change the immutable core or the tables themselves. SQLSTATE 42501 (insufficient privilege)
// is what PostgreSQL answers to every one of them: "permission denied for table x", and for DROP "must be owner of table x".

const DENIED = [
  ['update cla_versions', 'update cla_versions set rationale = rationale'],
  ['delete from signatures', 'delete from signatures'],
  ['truncate audit_log', 'truncate audit_log'],
  ['drop table signatures', 'drop table signatures'],
];

test.each(DENIED)('as cla_app, %s fails with insufficient privilege', async (_name, statement) => {
  const result = await sqlAs(stack, 'cla_app', statement);
  expect(result.code).not.toBe(0);
  expect(output(result)).toMatch(/42501.*(permission denied|must be owner)/);
});

test('as cla_app, reading the signatures works, so the refusals above are about privilege and not about the connection', async () => {
  const result = await sqlAs(stack, 'cla_app', 'select count(*) from signatures');
  expect(result.code, output(result)).toBe(0);
  expect(result.stdout.trim()).toBe('0');
});

test('cla_app owns no table, view, sequence or schema in the database', async () => {
  const objects = await sqlAs(
    stack,
    'cla_owner',
    "select count(*) from pg_class c join pg_roles r on r.oid = c.relowner where r.rolname = 'cla_app'",
  );
  expect([objects.code, objects.stdout.trim()]).toEqual([0, '0']);
  const schemas = await sqlAs(
    stack,
    'cla_owner',
    "select count(*) from pg_namespace n join pg_roles r on r.oid = n.nspowner where r.rolname = 'cla_app'",
  );
  expect([schemas.code, schemas.stdout.trim()]).toEqual([0, '0']);
});

test('the owner role cla_owner owns the signature tables', async () => {
  const result = await sqlAs(stack, 'cla_owner', "select tableowner from pg_tables where tablename = 'signatures'");
  expect([result.code, result.stdout.trim()]).toEqual([0, 'cla_owner']);
});
