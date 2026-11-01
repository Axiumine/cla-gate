// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';
import { connectionUrl, DATABASE_NAME } from './dev-db.ts';

// docker-compose.yml and the helper repeat the development credentials; these tests keep the two in step and pin the
// rule that the file never publishes a fixed host port.

const ROOT = path.resolve(import.meta.dirname, '../../..');
const composeSchema = z.object({
  services: z.record(
    z.string(),
    z.object({
      ports: z.array(z.string()).optional(),
      environment: z.record(z.string(), z.string()).optional(),
    }),
  ),
});

function readCompose() {
  const parsed: unknown = parse(fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8'));
  return composeSchema.parse(parsed);
}

test('the only published port is loopback bound, comes from POSTGRES_PORT and has no default', () => {
  const published = Object.values(readCompose().services).flatMap((service) => service.ports ?? []);
  expect(published).toHaveLength(1);
  expect(published[0]).toMatch(/^127\.0\.0\.1:\$\{POSTGRES_PORT:\?[^}]+\}:5432$/);
  expect(published[0]).not.toMatch(/POSTGRES_PORT:-/);
});

test('the owner credentials and the database name in the compose file are the helper ones', () => {
  const environment = readCompose().services['postgres']?.environment;
  const owner = new URL(connectionUrl('owner', 40_000));
  expect(environment?.['POSTGRES_USER']).toBe(owner.username);
  expect(environment?.['POSTGRES_PASSWORD']).toBe(owner.password);
  expect(environment?.['POSTGRES_DB']).toBe(DATABASE_NAME);
  expect(owner.pathname).toBe(`/${DATABASE_NAME}`);
});

test('the runtime role in the init script is the helper one', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'docker/postgres-init.sql'), 'utf8');
  const app = new URL(connectionUrl('app', 40_000));
  expect(sql).toContain(`create role ${app.username} login password '${app.password}'`);
});
