// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from 'vitest';
import { csrfToken, csrfTokenMatches } from '../../src/server/adapters/http/csrf-token.ts';
import { AUTH_ENV } from '../../src/server/config/auth-fixture/test-support.ts';
import { ConfigError } from '../../src/server/config/config-error.ts';
import { loadConfig } from '../../src/server/config/env.ts';
import { Secret } from '../../src/server/config/secret.ts';
import { resolveSecretFiles, SECRET_VARIABLES } from '../../src/server/config/secret-files.ts';
import { TEST_WEBHOOK_SECRET, testRsaKey } from '../../src/server/config/test-support.ts';
import { findOnPath, readText } from '../ci/lib/test-support.ts';
import { tempDir } from '../code-caps/test-support.ts';
import { modeOf, readCompose, serviceNamed } from '../compose/test-support.ts';
import {
  codeBlocks,
  guide,
  ROOT,
  readHeldAcross,
  sectionsOf,
  serverSource,
  tablesOf,
  writeScratch,
} from './test-support.ts';

// docs/operations/key-rotation.md against the code (E19-S09): one section for each secret in the order of SECRET_VARIABLES, the
// files and services of the table are the ones the compose file wires, the steps do what the page says, and the events it
// tells the operator to look for are the ones the server logs.

const rotation = guide('key-rotation');
const sections = sectionsOf(rotation, 2);
const variablesOf = (heading: string): string[] =>
  [...heading.matchAll(/`([A-Z][A-Z0-9_]+)`/g)].map((match) => match[1] ?? '');
const compose = readCompose();
const filesOf = (variable: string): string => variable.toLowerCase();
const DATABASE_URL = 'postgres://cla_app:made-up@db.example.test:5432/cla';
const KEY = testRsaKey();
const OTHER_KEY = testRsaKey();
const NORMAL = {
  ...AUTH_ENV,
  DATABASE_URL,
  NODE_ENV: 'production',
  PUBLIC_BASE_URL: 'https://cla.example.org',
  GITHUB_APP_ID: '1234',
  GITHUB_APP_PRIVATE_KEY: KEY.pkcs8,
  GITHUB_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
};

function variablesWronglyIn(env: Record<string, string>): readonly string[] {
  try {
    loadConfig({ ...NORMAL, ...env });
  } catch (error) {
    if (error instanceof ConfigError) {
      return error.variables;
    }
    throw error;
  }
  return [];
}

test('there is one section for each secret variable, in the order of SECRET_VARIABLES, after the one that explains how rotation works', () => {
  const rotations = sections.slice(sections.findIndex((section) => section.heading === 'How rotation works') + 1);
  expect(rotations.flatMap((section) => variablesOf(section.heading))).toEqual([...SECRET_VARIABLES]);
  expect(rotations.map((section) => variablesOf(section.heading).length)).toEqual([2, 2, 1, 1, 1, 2]);
});

test('the table lists every secret variable once, with its file and the service that reads it, and the compose file agrees', () => {
  const [table] = tablesOf(sections.find((section) => section.heading === 'How rotation works')?.body ?? '');
  const rows = (table?.rows ?? []).map(([variables = '', file = '', reader = '']) => ({
    variables: [...variables.matchAll(/`([A-Z_]+)`/g)].map((match) => match[1] ?? ''),
    files: [...file.matchAll(/`([a-z_]+)`/g)].map((match) => match[1] ?? ''),
    reader: reader.replaceAll('`', ''),
  }));
  expect(rows.flatMap((row) => row.variables)).toEqual([...SECRET_VARIABLES]);
  const secrets = new Map(Object.entries(compose.secrets));
  for (const row of rows) {
    const service = serviceNamed(compose, row.reader);
    const environment = new Map(Object.entries(service.environment ?? {}));
    expect(row.files).toEqual(row.variables.map(filesOf));
    for (const variable of row.variables) {
      const file = filesOf(variable);
      expect(environment.get(`${variable}_FILE`), variable).toBe(`/run/secrets/${file}`);
      expect(service.secrets, variable).toContain(file);
      expect(secrets.get(file)?.file).toBe(`./secrets/${file}`);
    }
  }
  expect(rows.filter((row) => row.reader === 'migrate').flatMap((row) => row.variables)).toEqual([
    'MIGRATION_DATABASE_URL',
  ]);
});

test('the events the page tells the operator to look for are logged by the server under those names', () => {
  const source = serverSource();
  const named = [
    'github.app_configured',
    'keyFingerprints',
    'github.app_keys_refused',
    'github.app_key_fallback',
    'webhook.secret_previous_used',
    'config.mode',
  ];
  expect(named.filter((event) => !rotation.includes(event))).toEqual([]);
  expect(named.filter((event) => !source.includes(event))).toEqual([]);
  expect(rotation).toContain('401 webhook_signature_invalid');
  expect(source).toContain('webhook_signature_invalid');
});

test('a file that is replaced with install is a new file, which is why a running container needs a restart; an empty one is empty', () => {
  const directory = tempDir();
  const staged = writeScratch(directory, 'new.tmp', 'new\n');
  const target = writeScratch(directory, 'session_secret', 'old\n', 0o444);
  const install = findOnPath('install');
  const seenByContainer = readHeldAcross(target, () => {
    expect(spawnSync(install, ['-m', '0444', staged, target]).status).toBe(0);
  });
  expect(seenByContainer).toBe('old\n');
  expect(readText(target)).toBe('new\n');
  expect(modeOf(target)).toBe('444');
  expect(spawnSync(install, ['-m', '0444', '/dev/null', target]).status).toBe(0);
  expect(readText(target)).toBe('');
  expect(rotation).toContain('install -m 0444 new.tmp secrets/session_secret');
  expect(rotation).toContain('install -m 0444 /dev/null secrets/github_app_private_key_previous');
});

test('the server removes exactly one line break from a secret file, and an emptied previous file counts as no previous secret', () => {
  const directory = tempDir();
  const read = (text: string) =>
    resolveSecretFiles({ SESSION_SECRET_FILE: writeScratch(directory, 'session', text) }).env['SESSION_SECRET'];
  expect(read('value\n')).toBe('value');
  expect(read('value\n\n')).toBe('value\n');
  expect(read('value')).toBe('value');
  expect(
    resolveSecretFiles({ GITHUB_WEBHOOK_SECRET_PREVIOUS_FILE: writeScratch(directory, 'previous', '') }).issues,
  ).toEqual([]);
  expect(rotation).toMatch(/the server removes exactly one/);
});

test('minimum lengths: 16 characters for the webhook secret, 32 for the session secret and the setup token', () => {
  expect(variablesWronglyIn({ GITHUB_WEBHOOK_SECRET: 'x'.repeat(15) })).toEqual(['GITHUB_WEBHOOK_SECRET']);
  expect(variablesWronglyIn({ GITHUB_WEBHOOK_SECRET: 'x'.repeat(16) })).toEqual([]);
  expect(variablesWronglyIn({ SESSION_SECRET: 'x'.repeat(31) })).toEqual(['SESSION_SECRET']);
  expect(variablesWronglyIn({ SESSION_SECRET: 'x'.repeat(32) })).toEqual([]);
  expect(variablesWronglyIn({ SETUP_TOKEN: 'x'.repeat(31) })).toEqual(['SETUP_TOKEN']);
  expect(variablesWronglyIn({ SETUP_TOKEN: 'x'.repeat(32) })).toEqual([]);
  expect(rotation).toMatch(/at least 16 characters/);
  expect(rotation).toMatch(/at least 32 characters/);
});

test('the same key, or the same secret, as the previous one is a start-up error that names the previous variable', () => {
  expect(variablesWronglyIn({ GITHUB_APP_PRIVATE_KEY_PREVIOUS: KEY.pkcs8 })).toEqual([
    'GITHUB_APP_PRIVATE_KEY_PREVIOUS',
  ]);
  expect(variablesWronglyIn({ GITHUB_APP_PRIVATE_KEY_PREVIOUS: OTHER_KEY.pkcs8 })).toEqual([]);
  expect(variablesWronglyIn({ GITHUB_WEBHOOK_SECRET_PREVIOUS: TEST_WEBHOOK_SECRET })).toEqual([
    'GITHUB_WEBHOOK_SECRET_PREVIOUS',
  ]);
  expect(variablesWronglyIn({ GITHUB_WEBHOOK_SECRET_PREVIOUS: `${TEST_WEBHOOK_SECRET}-older` })).toEqual([]);
  expect(rotation).toContain('naming `GITHUB_APP_PRIVATE_KEY_PREVIOUS`');
});

test('rotating the session secret signs nobody out and refuses the CSRF tokens issued before: the token is keyed on the secret, the session is not', () => {
  const before = new Secret('s'.repeat(32));
  const after = new Secret('t'.repeat(32));
  const issued = csrfToken(before, 'csrf-secret-of-a-session');
  expect(csrfTokenMatches(before, 'csrf-secret-of-a-session', issued)).toBe(true);
  expect(csrfTokenMatches(after, 'csrf-secret-of-a-session', issued)).toBe(false);
  expect(csrfTokenMatches(after, 'csrf-secret-of-a-session', csrfToken(after, 'csrf-secret-of-a-session'))).toBe(true);
  const signing = readText(path.join(ROOT, 'src/server/adapters/http/oauth-cookie.ts'));
  expect(signing).toContain('signed: true');
  const others = ['auth-login.ts', 'auth-callback.ts', 'auth-logout.ts', 'auth-routes.ts', 'auth.ts'].filter((file) =>
    readText(path.join(ROOT, 'src/server/adapters/http', file)).includes('signed: true'),
  );
  expect(others).toEqual([]);
  expect(readText(path.join(ROOT, 'src/web/i18n/messages.ts'))).toContain(
    'Your session could not be verified. Reload the page and try again.',
  );
  expect(rotation).toContain('Your session could not be verified. Reload the page and try again.');
  expect(rotation).toContain('it is not signed with this secret');
});

test('the database role passwords: the sequence regenerates only what was removed, and runs the provisioning script inside the container as the administrator', () => {
  const [sequence] = codeBlocks(rotation, 'sh').filter((block) => block.text.includes('provision'));
  expect(sequence?.text.split('\n')).toEqual([
    'rm secrets/db_owner_password secrets/db_app_password secrets/database_url secrets/migration_database_url',
    'sh scripts/init-secrets.sh',
    'docker compose restart postgres',
    'docker compose exec -T -e PGUSER=postgres postgres sh /docker-entrypoint-initdb.d/10-provision-database.sh',
    'docker compose restart app',
  ]);
  expect(serviceNamed(compose, 'postgres').volumes).toContain(
    './scripts/provision-database.sh:/docker-entrypoint-initdb.d/10-provision-database.sh:ro',
  );
  const provisioning = readText(path.join(ROOT, 'scripts/provision-database.sql'));
  expect(provisioning).toContain('password: set');
  expect(rotation).toContain('role cla_owner password: set');
  expect(rotation).toContain('role cla_app password: set');
});

test('init-secrets.sh creates only what is missing, so the removed files are the ones it makes again', () => {
  const script = readText(path.join(ROOT, 'scripts/init-secrets.sh'));
  expect(script).toMatch(/unless it exists/);
  expect(script).toContain('chmod 0444');
  expect(script).toContain('chmod 0700');
  expect(rotation).toContain('mode 0444 inside a 0700 directory');
});

test('every secret file that a command of the page names is one of the secrets of the compose file', () => {
  const named = [
    ...codeBlocks(rotation, 'sh')
      .map((block) => block.text)
      .join('\n')
      .matchAll(/secrets\/([a-z_]+)/g),
  ].map((match) => match[1] ?? '');
  expect(named.length).toBeGreaterThan(10);
  expect(named.filter((file) => !Object.keys(compose.secrets).includes(file))).toEqual([]);
});
