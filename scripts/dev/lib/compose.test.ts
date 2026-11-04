// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';
import { connectionUrl, DATABASE_NAME } from './dev-db.ts';

// docker-compose.dev.yml (E19-S04) and the helper repeat the development credentials; these tests keep the two in step and
// pin the rule that the file never publishes a fixed host port. The roles themselves come from
// scripts/provision-database.sh, which the image runs on the first start of an empty volume.

const ROOT = path.resolve(import.meta.dirname, '../../..');
const composeSchema = z.object({
  name: z.string(),
  services: z.record(
    z.string(),
    z.object({
      ports: z.array(z.string()).optional(),
      environment: z.record(z.string(), z.string()).optional(),
      volumes: z.array(z.string()).optional(),
    }),
  ),
});

function readCompose() {
  const parsed: unknown = parse(fs.readFileSync(path.join(ROOT, 'docker-compose.dev.yml'), 'utf8'));
  return composeSchema.parse(parsed);
}

test('the development stack has its own project name, apart from the operator stack', () => {
  expect(readCompose().name).toBe('cla-gate-dev');
});

test('the only published port is loopback bound, comes from POSTGRES_PORT and has no default', () => {
  const published = Object.values(readCompose().services).flatMap((service) => service.ports ?? []);
  expect(published).toHaveLength(1);
  expect(published[0]).toMatch(/^127\.0\.0\.1:\$\{POSTGRES_PORT:\?[^}]+\}:5432$/);
  expect(published[0]).not.toMatch(/POSTGRES_PORT:-/);
});

test('the role passwords handed to the provisioning script are the helper ones', () => {
  const environment = readCompose().services['postgres']?.environment;
  expect(environment?.['CLA_OWNER_PASSWORD']).toBe(new URL(connectionUrl('owner', 40_000)).password);
  expect(environment?.['CLA_APP_PASSWORD']).toBe(new URL(connectionUrl('app', 40_000)).password);
});

test('the helper names the roles and the database the script creates by default, and the file overrides none of them', () => {
  const environment = readCompose().services['postgres']?.environment ?? {};
  expect(Object.keys(environment).filter((name) => name === 'CLA_DB_NAME' || name === 'CLA_OWNER_ROLE')).toEqual([]);
  expect(new URL(connectionUrl('owner', 40_000)).username).toBe('cla_owner');
  expect(new URL(connectionUrl('app', 40_000)).username).toBe('cla_app');
  expect(new URL(connectionUrl('app', 40_000)).pathname).toBe(`/${DATABASE_NAME}`);
  expect(DATABASE_NAME).toBe('cla');
});

test('the script and its SQL file are mounted read-only, the SQL outside the init directory the image runs by itself', () => {
  const service = readCompose().services['postgres'];
  expect(service?.volumes).toEqual(
    expect.arrayContaining([
      './scripts/provision-database.sh:/docker-entrypoint-initdb.d/10-provision-database.sh:ro',
      './scripts/provision-database.sql:/opt/cla/provision-database.sql:ro',
    ]),
  );
  expect(service?.environment?.['CLA_PROVISION_SQL']).toBe('/opt/cla/provision-database.sql');
});

test('the old init script that created the runtime role is gone: the roles are defined in one place', () => {
  expect(fs.existsSync(path.join(ROOT, 'docker/postgres-init.sql'))).toBe(false);
});
