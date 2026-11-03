// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { ConfigError } from './config-error.ts';
import { loadMigrateConfig } from './migrate-config.ts';
import { secretDirectory } from './secret-fixture/test-support.ts';

// E19-S02: the migration entry point reads `MIGRATION_DATABASE_URL_FILE` and `DATABASE_URL_FILE` with the resolver of the
// server. The rest of what `loadMigrateConfig` does is in env.test.ts.

const OWNER = 'postgres://cla_owner:made-up-owner-password@db.internal:5432/cla';
const RUNTIME = 'postgres://cla_app:made-up-app-password@db.internal:5432/cla';

function linesOf(env: Record<string, string | undefined>): readonly string[] {
  try {
    loadMigrateConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) {
      return error.lines;
    }
    throw error;
  }
  throw new Error('expected loadMigrateConfig to throw');
}

test('the owner connection comes from MIGRATION_DATABASE_URL_FILE, without the line break at its end', () => {
  const files = secretDirectory();
  const env = { MIGRATION_DATABASE_URL_FILE: files.write('migration_database_url', `${OWNER}\n`) };
  expect(loadMigrateConfig(env).databaseUrl.reveal()).toBe(OWNER);
});

test('without an owner connection the runtime one is read from DATABASE_URL_FILE', () => {
  const files = secretDirectory();
  const env = { DATABASE_URL_FILE: files.write('database_url', `${RUNTIME}\r\n`) };
  expect(loadMigrateConfig(env).databaseUrl.reveal()).toBe(RUNTIME);
});

test('the owner connection wins, and an unreadable DATABASE_URL_FILE is never looked at when it is not needed', () => {
  const files = secretDirectory();
  const env = { MIGRATION_DATABASE_URL: OWNER, DATABASE_URL_FILE: files.at('absent') };
  expect(loadMigrateConfig(env).databaseUrl.reveal()).toBe(OWNER);
  const viaFile = { MIGRATION_DATABASE_URL_FILE: files.write('owner', OWNER), DATABASE_URL_FILE: files.root };
  expect(loadMigrateConfig(viaFile).databaseUrl.reveal()).toBe(OWNER);
});

test('an empty placeholder file for the owner connection is unset: the runtime connection serves outside production', () => {
  const files = secretDirectory();
  const env = {
    MIGRATION_DATABASE_URL_FILE: files.write('owner', ''),
    DATABASE_URL_FILE: files.write('runtime', RUNTIME),
  };
  expect(loadMigrateConfig(env).databaseUrl.reveal()).toBe(RUNTIME);
});

test('in production an empty placeholder is not an owner connection, and the line says where to set it', () => {
  const files = secretDirectory();
  const env = {
    NODE_ENV: 'production',
    MIGRATION_DATABASE_URL_FILE: files.write('owner', '\n'),
    DATABASE_URL_FILE: files.write('runtime', RUNTIME),
  };
  expect(linesOf(env)).toEqual([
    'MIGRATION_DATABASE_URL: required in production; set it, or MIGRATION_DATABASE_URL_FILE',
  ]);
  expect(
    loadMigrateConfig({ ...env, MIGRATION_DATABASE_URL_FILE: files.write('owner2', OWNER) }).databaseUrl.reveal(),
  ).toBe(OWNER);
});

test.each([
  ['MIGRATION_DATABASE_URL', OWNER],
  ['DATABASE_URL', RUNTIME],
])('%s and its file together are `set only one`', (name, url) => {
  const files = secretDirectory();
  const env = { [name]: url, [`${name}_FILE`]: files.write('both', url) };
  expect(linesOf(env)).toEqual([`${name}, ${name}_FILE: set only one`]);
});

test.each(['MIGRATION_DATABASE_URL', 'DATABASE_URL'])(
  'a missing file of %s is `N_FILE: cannot read <path> (ENOENT)`',
  (name) => {
    const files = secretDirectory();
    const missing = files.at('absent');
    expect(linesOf({ [`${name}_FILE`]: missing })).toEqual([`${name}_FILE: cannot read ${missing} (ENOENT)`]);
  },
);

test.each([
  ['MIGRATION_DATABASE_URL', 'must be a postgres:// or postgresql:// connection string'],
  ['DATABASE_URL', 'must be a postgres:// or postgresql:// connection string (required; set it, or DATABASE_URL_FILE)'],
])('a file of %s with something else in it is refused by the rule of the variable', (name, rule) => {
  const files = secretDirectory();
  expect(linesOf({ [`${name}_FILE`]: files.write('wrong', 'mysql://u:p@h/db') })).toEqual([`${name}: ${rule}`]);
});
