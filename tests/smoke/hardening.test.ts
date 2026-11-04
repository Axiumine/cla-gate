// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { execIn, inspectService, output } from '../../scripts/smoke/probe.ts';
import { stack } from './support.ts';

// E19-S08, hardening, read through `docker inspect` and `docker exec`: the application and the migration run as a numeric
// non-root user on a read-only root file system with no capability and no way to gain one, the one writable place is /tmp,
// and the database has no port on the host.

const APPLICATION_SERVICES = [['app'], ['migrate']];

/** The names of the `NAME=value` lines, never the values. */
function namesOf(lines: readonly string[]): string[] {
  return lines.filter((line) => line.includes('=')).map((line) => line.slice(0, line.indexOf('=')));
}

test.each(APPLICATION_SERVICES)('%s runs as a numeric user that is not root', async (service) => {
  const { Config } = await inspectService(stack, service);
  expect(Config.User).toBe('10001:10001');
});

test.each(APPLICATION_SERVICES)('%s has a read-only root file system', async (service) => {
  expect((await inspectService(stack, service)).HostConfig.ReadonlyRootfs).toBe(true);
});

test.each(APPLICATION_SERVICES)('%s has dropped every capability and cannot gain privileges', async (service) => {
  const { HostConfig } = await inspectService(stack, service);
  expect(HostConfig.CapDrop).toEqual(['ALL']);
  expect(HostConfig.SecurityOpt).toContain('no-new-privileges:true');
});

test('a write to /app fails and a write to /tmp works', async () => {
  const denied = await execIn(stack, 'app', ['sh', '-c', 'echo probe > /app/probe']);
  expect(denied.code).not.toBe(0);
  expect(output(denied)).toMatch(/read-only file system|permission denied/i);
  const allowed = await execIn(stack, 'app', ['sh', '-c', 'echo probe > /tmp/probe && cat /tmp/probe']);
  expect(allowed.code, output(allowed)).toBe(0);
  expect(allowed.stdout.trim()).toBe('probe');
});

test('the root file system itself is read-only, not only the application tree', async () => {
  const denied = await execIn(stack, 'app', ['sh', '-c', 'echo probe > /probe']);
  expect(denied.code).not.toBe(0);
  expect(output(denied)).toMatch(/read-only file system/i);
});

test('postgres publishes no port on the host, and app only on the loopback address', async () => {
  const database = await inspectService(stack, 'postgres');
  expect(Object.values(database.NetworkSettings.Ports).flat().filter(Boolean)).toEqual([]);
  expect(database.HostConfig.PortBindings ?? {}).toEqual({});
  const application = await inspectService(stack, 'app');
  expect(application.NetworkSettings.Ports['3000/tcp']).toEqual([
    { HostIp: '127.0.0.1', HostPort: String(stack.port) },
  ]);
});

test('app runs as that user and holds no owner credential, in its environment or among its secret files', async () => {
  const identity = await execIn(stack, 'app', ['id', '-u']);
  expect(identity.stdout.trim()).toBe('10001');
  const configured = namesOf((await inspectService(stack, 'app')).Config.Env);
  const running = namesOf((await execIn(stack, 'app', ['env'])).stdout.split('\n'));
  expect(configured).toContain('DATABASE_URL_FILE');
  for (const names of [configured, running]) {
    expect(names.filter((name) => name.startsWith('MIGRATION_DATABASE_URL'))).toEqual([]);
  }
  const secrets = await execIn(stack, 'app', ['ls', '/run/secrets']);
  expect(secrets.code, output(secrets)).toBe(0);
  expect(secrets.stdout.split('\n')).toContain('database_url');
  expect(secrets.stdout.split('\n').filter((name) => /owner|migration/.test(name))).toEqual([]);
});
