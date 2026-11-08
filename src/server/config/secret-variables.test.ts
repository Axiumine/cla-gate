// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { loadConfig } from './env.ts';
import { buildEnvSchema } from './env-schema.ts';
import { loadMigrateConfig } from './migrate-config.ts';
import { Secret } from './secret.ts';
import { SECRET_VARIABLES } from './secret-files.ts';
import { sampleEnvironment, secretDirectory } from './secret-fixture/test-support.ts';

// E19-S02: every secret variable has an `N_FILE` variant, and the list of them is one constant. This walks the environment
// schema, so a secret added to the schema without a `_FILE` entry (or an entry without a field) fails here.

/** Read by `loadMigrateConfig` only: it is no field of the server's schema, and the migration command has its own parse. */
const MIGRATION_ONLY: readonly string[] = ['MIGRATION_DATABASE_URL'];

/** The list as plain strings, so that a name taken from the schema can be looked up in it. */
const LISTED: readonly string[] = SECRET_VARIABLES;
const byName = (a: string, b: string): number => a.localeCompare(b);
const SAMPLE = sampleEnvironment();

/** The properties of an object, typed as what they are for a walk that knows nothing about them. */
function entriesOf(value: object): [string, unknown][] {
  return Object.entries(value);
}

/** True for a field whose parsed value is a Secret, or holds one (the GitHub App key is `{ pem: Secret, fingerprint }`). */
function producesSecret(value: unknown): boolean {
  return (
    value instanceof Secret ||
    (typeof value === 'object' && value !== null && entriesOf(value).some(([, part]) => part instanceof Secret))
  );
}

/** A parsed value with every Secret replaced by its text (a list becomes an object keyed by position): what two loads must agree on. */
function revealed(value: unknown): unknown {
  if (value instanceof Secret) {
    return value.reveal();
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(entriesOf(value).map(([key, part]) => [key, revealed(part)]));
  }
  return value;
}

/** The fields of the schema, read when a test runs: the schema is built then and not at import. */
function fields(): string[] {
  return Object.keys(buildEnvSchema().shape);
}

/** The fields whose value is a Secret, or holds one, once the sample environment is parsed. */
function producers(): string[] {
  return entriesOf(buildEnvSchema().parse(SAMPLE))
    .filter(([, value]) => producesSecret(value))
    .map(([name]) => name);
}

/** The listed names the server's schema reads. The tests below pin that they are exactly the fields that produce a Secret. */
const SERVER_SECRETS = LISTED.filter((name) => !MIGRATION_ONLY.includes(name));

test('the list is pinned, in the order the operator guides use, without a duplicate', () => {
  expect(SECRET_VARIABLES).toEqual([
    'GITHUB_APP_PRIVATE_KEY',
    'GITHUB_APP_PRIVATE_KEY_PREVIOUS',
    'GITHUB_WEBHOOK_SECRET',
    'GITHUB_WEBHOOK_SECRET_PREVIOUS',
    'GITHUB_CLIENT_SECRET',
    'SESSION_SECRET',
    'SETUP_TOKEN',
    'DATABASE_URL',
    'MIGRATION_DATABASE_URL',
  ]);
  expect(new Set(SECRET_VARIABLES).size).toBe(SECRET_VARIABLES.length);
});

test('the sample environment gives a value to every field of the schema, so the walk below sees all of them', () => {
  expect(Object.keys(SAMPLE).toSorted(byName)).toEqual(fields().toSorted(byName));
});

test('every field that produces a Secret has a _FILE entry in SECRET_VARIABLES', () => {
  const found = producers();
  expect(found.length).toBeGreaterThanOrEqual(7);
  expect(found.filter((name) => !LISTED.includes(name))).toEqual([]);
});

test('every entry has a schema field that produces a Secret, except the one the migration command reads', () => {
  const found = producers();
  const schemaFields = fields();
  expect(SECRET_VARIABLES.filter((name) => !found.includes(name)).toSorted(byName)).toEqual(MIGRATION_ONLY);
  expect(SECRET_VARIABLES.filter((name) => !schemaFields.includes(name)).toSorted(byName)).toEqual(MIGRATION_ONLY);
});

test('the migration-only entry is a variable of the migration command, which reads its _FILE too', () => {
  const files = secretDirectory();
  const url = 'postgres://cla_owner:made-up-owner-password@db.internal:5432/cla';
  const config = loadMigrateConfig({ MIGRATION_DATABASE_URL_FILE: files.write('owner', `${url}\n`) });
  expect(config.databaseUrl.reveal()).toBe(url);
});

test.each(SERVER_SECRETS)('%s from a file gives the same configuration as the value itself', (name) => {
  const files = secretDirectory();
  const { [name]: value = '', ...rest } = SAMPLE;
  // The editor's line break after the value is part of the file and not of the secret.
  const viaFile = loadConfig({ ...rest, [`${name}_FILE`]: files.write(name, `${value}\n`) });
  expect(revealed(viaFile)).toEqual(revealed(loadConfig(SAMPLE)));
});
