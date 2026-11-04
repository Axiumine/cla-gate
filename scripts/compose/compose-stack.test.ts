// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { expect, test } from 'vitest';
import { readText } from '../ci/lib/test-support.ts';
import {
  byName,
  checkout,
  defaultsOf,
  interpolated,
  ROOT,
  readCompose,
  STACK_SUBNET,
  serviceNamed,
  withDefault,
} from './test-support.ts';

// E19-S04: what docker-compose.yml promises, read from the parsed file (the `<<` merge of the shared anchor applied). The
// run of the stack itself is recorded in the pull request and automated by the smoke test of E19-S08.

const compose = readCompose();
const postgres = serviceNamed(compose, 'postgres');
const migrate = serviceNamed(compose, 'migrate');
const app = serviceNamed(compose, 'app');

test('a service that is not in the file fails the test that asked for it', () => {
  expect(() => serviceNamed(compose, 'nothing')).toThrow('docker-compose.yml has no service nothing');
});

test('the project is cla-gate and the services are postgres, migrate, app and the optional caddy', () => {
  expect(compose.name).toBe('cla-gate');
  expect(Object.keys(compose.services)).toEqual(['postgres', 'migrate', 'app', 'caddy']);
  expect(Object.entries(compose.services).filter(([, service]) => service.profiles !== undefined)).toEqual([
    ['caddy', expect.objectContaining({ profiles: ['tls'] })],
  ]);
});

test('postgres is the 18 image with its admin password from a secret file, and publishes no port', () => {
  expect(postgres.image).toBe('postgres:18');
  expect(postgres.environment?.['POSTGRES_PASSWORD_FILE']).toBe('/run/secrets/db_admin_password');
  expect(postgres.ports).toBeUndefined();
  expect(postgres.restart).toBe('unless-stopped');
});

test('postgres provisions the roles on an empty volume: the script is mounted read-only into the init directory', () => {
  expect(postgres.volumes).toEqual([
    'cla-postgres-data:/var/lib/postgresql',
    './scripts/provision-database.sh:/docker-entrypoint-initdb.d/10-provision-database.sh:ro',
    './scripts/provision-database.sql:/opt/cla/provision-database.sql:ro',
  ]);
  expect(Object.keys(compose.volumes)).toEqual(['cla-postgres-data', 'caddy-data', 'caddy-config']);
  expect(postgres.environment).toEqual({
    POSTGRES_PASSWORD_FILE: '/run/secrets/db_admin_password',
    CLA_OWNER_PASSWORD_FILE: '/run/secrets/db_owner_password',
    CLA_APP_PASSWORD_FILE: '/run/secrets/db_app_password',
    CLA_PROVISION_SQL: '/opt/cla/provision-database.sql',
  });
  expect(postgres.secrets).toEqual(['db_admin_password', 'db_owner_password', 'db_app_password']);
});

test('postgres is healthy only when it answers over TCP, which the temporary server of the init scripts does not', () => {
  expect(postgres.healthcheck?.test).toEqual(['CMD-SHELL', 'pg_isready -h 127.0.0.1 -U cla_app -d cla']);
});

test('the database sits on the internal network backend, and nothing but postgres, migrate and app is on it', () => {
  expect(compose.networks['backend']).toEqual({ internal: true });
  expect([postgres.networks, migrate.networks, app.networks]).toEqual([
    ['backend'],
    ['backend'],
    ['backend', 'default'],
  ]);
});

test('migrate is the same build as app, runs the migration command once, and holds only the owner connection', () => {
  expect(migrate.command).toEqual(['node', 'dist/server/migrate.js']);
  expect(migrate.restart).toBe('no');
  expect(migrate.secrets).toEqual(['migration_database_url']);
  expect(migrate.environment).toEqual({ MIGRATION_DATABASE_URL_FILE: '/run/secrets/migration_database_url' });
  expect(migrate.depends_on).toEqual({ postgres: { condition: 'service_healthy' } });
  expect([migrate.image, migrate.build]).toEqual([app.image, app.build]);
});

test('app waits for a migration that finished successfully, and holds the runtime and GitHub credentials, never the owner', () => {
  expect(app.depends_on).toEqual({ migrate: { condition: 'service_completed_successfully' } });
  expect(app.secrets).toEqual([
    'database_url',
    'session_secret',
    'setup_token',
    'github_app_private_key',
    'github_app_private_key_previous',
    'github_webhook_secret',
    'github_webhook_secret_previous',
    'github_client_secret',
  ]);
  const owner = [...(app.secrets ?? []), ...Object.keys(app.environment ?? {})].filter(
    (name) => name.includes('migration') || name.includes('MIGRATION') || name.includes('db_owner'),
  );
  expect(owner).toEqual([]);
});

test.each([
  ['migrate', migrate],
  ['app', app],
])(
  '%s runs read-only with /tmp as its only writable place, no capability, no privilege gain and an init process',
  (_name, service) => {
    expect(service.read_only).toBe(true);
    expect(service.tmpfs).toEqual(['/tmp']);
    expect(service.cap_drop).toEqual(['ALL']);
    expect(service.security_opt).toEqual(['no-new-privileges:true']);
    expect(service.init).toBe(true);
  },
);

test('app restarts unless stopped, has 30 seconds to stop, and is built from the checkout as cla-gate:local', () => {
  expect(app.restart).toBe('unless-stopped');
  expect(app.stop_grace_period).toBe('30s');
  expect(app.image).toBe('cla-gate:local');
  expect(app.build).toEqual({ context: '.', args: { SOURCE_COMMIT: withDefault('SOURCE_COMMIT', 'unknown') } });
});

test('the app port is published on loopback by default, and only the proxy of the tls profile publishes anything else', () => {
  expect(app.ports).toEqual([`${withDefault('BIND_ADDRESS', '127.0.0.1')}:${withDefault('PORT', '3000')}:3000`]);
  expect([postgres.ports, migrate.ports]).toEqual([undefined, undefined]);
  expect(Object.entries(compose.services).flatMap(([name, { ports }]) => (ports === undefined ? [] : [name]))).toEqual([
    'app',
    'caddy',
  ]);
});

test('the default network has an explicit subnet, and app trusts exactly that subnet as its proxy', () => {
  expect(compose.networks['default']?.ipam?.config).toEqual([{ subnet: withDefault('EDGE_SUBNET', STACK_SUBNET) }]);
  expect(defaultsOf(app.environment ?? {}).get('TRUST_PROXY')).toBe(STACK_SUBNET);
});

test('every secret is a file under secrets/ named like the secret, mounted only where a service lists it', () => {
  expect(Object.entries(compose.secrets).filter(([name, { file }]) => file !== `./secrets/${name}`)).toEqual([]);
  const mounted = [postgres, migrate, app].flatMap((service) => service.secrets ?? []);
  expect([...new Set(mounted)].toSorted(byName)).toEqual(Object.keys(compose.secrets).toSorted(byName));
});

test('every _FILE variable points at a secret the service mounts, and a mounted secret is read by someone', () => {
  for (const service of [postgres, migrate, app]) {
    const files = Object.entries(service.environment ?? {})
      .filter(([name]) => name.endsWith('_FILE'))
      .map(([, value]) => value.replace('/run/secrets/', ''));
    expect(files.toSorted(byName)).toEqual([...(service.secrets ?? [])].toSorted(byName));
  }
});

test('the checkout creates every file the compose secrets name', () => {
  const box = checkout();
  box.run();
  expect(Object.keys(compose.secrets).filter((name) => !box.listing().includes(name))).toEqual([]);
});

test('no variable is interpolated that the stack does not document, and no literal credential is in the file', () => {
  const text = readText(path.join(ROOT, 'docker-compose.yml'));
  expect(interpolated(text).toSorted(byName)).toEqual(
    [
      'ACME_EMAIL',
      'BIND_ADDRESS',
      'CADDY_BIND_ADDRESS',
      'CADDY_HTTP_PORT',
      'CADDY_HTTPS_PORT',
      'EDGE_SUBNET',
      'GITHUB_ALLOWED_ACCOUNT_IDS',
      'GITHUB_APP_ID',
      'GITHUB_CLIENT_ID',
      'LOG_LEVEL',
      'NETWORK_METADATA_RETENTION_DAYS',
      'OPERATOR_GITHUB_IDS',
      'PORT',
      'PUBLIC_BASE_URL',
      'RECORD_NETWORK_METADATA',
      'SESSION_ABSOLUTE_SECONDS',
      'SESSION_IDLE_SECONDS',
      'SOURCE_COMMIT',
      'SOURCE_URL',
      'SWEEP_INTERVAL_MINUTES',
      'TRUST_PROXY',
      'WORKER_CONCURRENCY',
    ].toSorted(byName),
  );
  expect(text).not.toMatch(/postgres:\/\/|_PASSWORD:|_SECRET:|PRIVATE_KEY:/);
});
