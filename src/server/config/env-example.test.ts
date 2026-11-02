// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { loadConfig } from './env.ts';
import { envSchema } from './env-schema.ts';

// `.env.example` lists every variable the server reads (E10-S01), so a setting added to the schema cannot be forgotten.

const EXAMPLE = path.resolve(import.meta.dirname, '../../../.env.example');
/** Read by `loadMigrateConfig`, outside the schema. */
const MIGRATION_ONLY = ['MIGRATION_DATABASE_URL'];

const byName = (a: string, b: string): number => a.localeCompare(b);

const text = fs.readFileSync(EXAMPLE, 'utf8');
const assignments = text
  .split('\n')
  .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
  .map((line): [string, string] => {
    const at = line.indexOf('=');
    return [line.slice(0, at), line.slice(at + 1)];
  });

test('every variable of the environment schema is in .env.example, and nothing else is', () => {
  const documented = assignments.map(([name]) => name).toSorted(byName);
  expect(documented).toEqual([...Object.keys(envSchema.shape), ...MIGRATION_ONLY].toSorted(byName));
});

test('no variable is listed twice', () => {
  const names = assignments.map(([name]) => name);
  expect(new Set(names).size).toBe(names.length);
});

test('every secret is left empty, so the file holds no value that could be one', () => {
  const secrets = [
    'DATABASE_URL',
    'MIGRATION_DATABASE_URL',
    'SESSION_SECRET',
    'GITHUB_CLIENT_SECRET',
    'GITHUB_APP_PRIVATE_KEY',
    'GITHUB_APP_PRIVATE_KEY_PREVIOUS',
    'GITHUB_WEBHOOK_SECRET',
  ];
  const values = new Map(assignments);
  expect(secrets.map((name) => [name, values.get(name)])).toEqual(secrets.map((name) => [name, '']));
});

test('the example is a valid development configuration once the database is named', () => {
  const env = { ...Object.fromEntries(assignments), DATABASE_URL: 'postgres://cla_app:pw@127.0.0.1:5432/cla' };
  expect(loadConfig(env).session).toEqual({ idleSeconds: 28_800, absoluteSeconds: 604_800 });
});
