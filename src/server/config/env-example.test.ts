// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { loadConfig } from './env.ts';
import { envSchema } from './env-schema.ts';
import { SECRET_VARIABLES } from './secret-files.ts';

// `.env.example` lists every variable the server reads (E10-S01), so a setting added to the schema cannot be forgotten.

const EXAMPLE = path.resolve(import.meta.dirname, '../../../.env.example');
/** Read by `loadMigrateConfig`, outside the schema. */
const MIGRATION_ONLY = ['MIGRATION_DATABASE_URL'];
/**
 * Read by the compose stack and not by the server: where the app's port is published and the subnet of the stack's network
 * (E19-S04), the address Let's Encrypt writes to and the host side of the proxy's ports (E19-S05).
 * scripts/compose/compose-stack.test.ts and caddy-service.test.ts keep them in step with docker-compose.yml.
 */
const COMPOSE_ONLY = [
  'ACME_EMAIL',
  'BIND_ADDRESS',
  'CADDY_BIND_ADDRESS',
  'CADDY_HTTP_PORT',
  'CADDY_HTTPS_PORT',
  'EDGE_SUBNET',
];

const byName = (a: string, b: string): number => a.localeCompare(b);

const text = fs.readFileSync(EXAMPLE, 'utf8');
const assignments = text
  .split('\n')
  .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
  .map((line): [string, string] => {
    const at = line.indexOf('=');
    return [line.slice(0, at), line.slice(at + 1)];
  });

test('every variable of the environment schema is in .env.example, and nothing else is but what the stack reads', () => {
  const documented = assignments.map(([name]) => name).toSorted(byName);
  expect(documented).toEqual([...Object.keys(envSchema.shape), ...MIGRATION_ONLY, ...COMPOSE_ONLY].toSorted(byName));
});

test('no variable is listed twice', () => {
  const names = assignments.map(([name]) => name);
  expect(new Set(names).size).toBe(names.length);
});

test('every secret is left empty, so the file holds no value that could be one', () => {
  const values = new Map(assignments);
  expect(SECRET_VARIABLES.map((name) => [name, values.get(name)])).toEqual(SECRET_VARIABLES.map((name) => [name, '']));
});

test('the file says that every secret has a _FILE variant, without listing one as a variable', () => {
  expect(text).toContain('`<NAME>_FILE`');
  expect(assignments.filter(([name]) => name.endsWith('_FILE'))).toEqual([]);
});

test('the example is a valid development configuration once the database is named', () => {
  const env = { ...Object.fromEntries(assignments), DATABASE_URL: 'postgres://cla_app:pw@127.0.0.1:5432/cla' };
  expect(loadConfig(env).session).toEqual({ idleSeconds: 28_800, absoluteSeconds: 604_800 });
});
