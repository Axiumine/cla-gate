// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { makeRepo } from '../code-caps/test-support.ts';
import { runScript, sandbox } from './test-support.ts';

// E19-S04: the compose stacks mount the script into /docker-entrypoint-initdb.d/, whose entry point runs every .sql file it
// finds there on its own, so the SQL file lives elsewhere and CLA_PROVISION_SQL names it. Without the variable the file next
// to the script is used (provision-secrets.test.ts checks that one).

const PASSWORDS = { CLA_OWNER_PASSWORD: '0123456789abcdef-owner', CLA_APP_PASSWORD: '0123456789abcdef-application' };

test('CLA_PROVISION_SQL names the SQL file that reaches psql, instead of the one next to the script', () => {
  const box = sandbox();
  const custom = path.join(box.directory, 'elsewhere.sql');
  makeRepo(box.directory, { 'elsewhere.sql': 'select 1;\n' });
  const run = runScript(box, { ...PASSWORDS, CLA_PROVISION_SQL: custom });
  expect(run.status).toBe(0);
  expect(box.stdin()).toBe('select 1;\n');
});

test('an empty CLA_PROVISION_SQL counts as unset', () => {
  const box = sandbox();
  runScript(box, { ...PASSWORDS, CLA_PROVISION_SQL: '' });
  expect(box.stdin()).toBe(fs.readFileSync(path.resolve(import.meta.dirname, '../provision-database.sql'), 'utf8'));
});

test('a CLA_PROVISION_SQL that cannot be read stops the run before psql, naming the path', () => {
  const box = sandbox();
  const missing = path.join(box.directory, 'missing.sql');
  const run = runScript(box, { ...PASSWORDS, CLA_PROVISION_SQL: missing });
  expect([run.status, run.stderr, box.psqlCalled()]).toEqual([
    4,
    `provision-database: cannot read ${missing}\n`,
    false,
  ]);
});
