// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { expect, test } from 'vitest';
import { ConfigError } from '../../src/server/config/config-error.ts';
import { loadConfig } from '../../src/server/config/env.ts';
import { DEFAULT_SOURCE_URL, installUrlFor, sourceCodeUrl } from '../../src/shared/meta.ts';
import { readText } from '../ci/lib/test-support.ts';
import { assignments, readCompose, serviceNamed, withDefault } from '../compose/test-support.ts';
import { codeBlocks, guide, inOrder, ROOT, sectionsOf } from './test-support.ts';

// docs/operations/install.md against the stack and the code it describes (E19-S09): the path the story fixes, in its order, and
// the statements that a change to the code could make false.

const install = guide('install');
const commands = codeBlocks(install, 'sh')
  .map((block) => block.text)
  .join('\n');
const dotenv = assignments(readText(path.join(ROOT, '.env.example')));
const DATABASE_URL = 'postgres://cla_app:made-up@db.example.test:5432/cla';

test('the install path is clone, secrets, settings, build with the proxy, setup, restart, install the App, in that order', () => {
  expect(
    inOrder(install, [
      'git clone',
      'sh scripts/init-secrets.sh',
      'PUBLIC_BASE_URL=https://cla.example.com',
      'SOURCE_COMMIT=$(git rev-parse HEAD) docker compose --profile tls up --build -d',
      'https://cla.example.com/setup',
      'install -m 0444',
      'SOURCE_COMMIT=$(git rev-parse HEAD) docker compose up -d',
      'https://github.com/apps/<slug>/installations/new',
    ]),
  ).toBe(true);
});

test('the commands that build the image are the ones of the story, and the clone is the repository the footer links to', () => {
  expect(commands).toContain(`git clone ${DEFAULT_SOURCE_URL}.git`);
  expect(commands).toContain('SOURCE_COMMIT=$(git rev-parse HEAD) docker compose --profile tls up --build -d');
});

test('the prerequisites name Docker with Compose v2, a DNS name, and ports 80 and 443', () => {
  const [needs] = sectionsOf(install, 2).filter((section) => section.heading === 'What you need');
  expect(needs?.body).toMatch(/Compose v2/);
  expect(needs?.body).toMatch(/DNS name/);
  expect(needs?.body).toMatch(/Ports 80 and 443/);
});

test('it says the image is built on the server and never downloaded', () => {
  expect(install).toMatch(/built on your server from the checkout/);
  expect(install).toMatch(/never downloaded from a registry/);
});

test('the settings it tells the operator to edit are in the example file', () => {
  const named = ['PUBLIC_BASE_URL', 'ACME_EMAIL', 'SOURCE_URL', 'GITHUB_APP_ID', 'GITHUB_CLIENT_ID'];
  expect(named.filter((name) => !install.includes(`\`${name}`))).toEqual([]);
  expect(named.filter((name) => !dotenv.has(name))).toEqual([]);
  expect(install).toContain('GITHUB_ALLOWED_ACCOUNT_IDS');
  expect(dotenv.has('GITHUB_ALLOWED_ACCOUNT_IDS')).toBe(true);
  expect(dotenv.has('OPERATOR_GITHUB_IDS')).toBe(true);
});

test('the secret files it names exist in the stack, and the setup page offers the three it asks the operator to install', () => {
  const secrets = Object.keys(readCompose().secrets);
  const downloaded = ['github_webhook_secret', 'github_client_secret', 'github_app_private_key'];
  const page = readText(path.join(ROOT, 'src/web/setup/credential-items.ts'));
  expect(downloaded.filter((name) => !secrets.includes(name))).toEqual([]);
  expect(downloaded.filter((name) => !page.includes(`'${name}'`))).toEqual([]);
  expect(downloaded.filter((name) => !commands.includes(`secrets/${name}`))).toEqual([]);
  expect(secrets).toContain('setup_token');
  expect(install).toContain('secrets/setup_token');
});

test('SOURCE_COMMIT: a known commit makes the footer name it, an unknown one makes it link to the repository', () => {
  const commit = '0123456789abcdef0123456789abcdef01234567';
  expect(sourceCodeUrl(DEFAULT_SOURCE_URL, commit)).toContain(commit);
  expect(sourceCodeUrl(DEFAULT_SOURCE_URL, null)).toBe(DEFAULT_SOURCE_URL);
  expect(install).toMatch(/AGPL-3\.0-only/);
  expect(install).toMatch(/section 13/);
  expect(install).toMatch(/`unknown`/);
});

test('SOURCE_COMMIT is part of the environment of app, so a later up without it re-creates the container with unknown', () => {
  const environment = serviceNamed(readCompose(), 'app').environment ?? {};
  expect(environment['SOURCE_COMMIT']).toBe(withDefault('SOURCE_COMMIT', 'unknown'));
  expect(install).toMatch(/belongs on every command that creates or re-creates `app`/);
});

test('the install link is the one the server builds from the slug', () => {
  expect(installUrlFor('cla-gate-example')).toBe('https://github.com/apps/cla-gate-example/installations/new');
  expect(install).toContain('https://github.com/apps/<slug>/installations/new');
});

test('the proxy is optional: only the service caddy is in the tls profile, and nothing else needs it', () => {
  const compose = readCompose();
  expect(serviceNamed(compose, 'caddy').profiles).toEqual(['tls']);
  expect(Object.keys(compose.services).filter((name) => name !== 'caddy')).toEqual(['postgres', 'migrate', 'app']);
  expect(install).toMatch(/Only with the profile `tls`/);
});

test('the admission policy it describes is the one the configuration accepts: ids, at most 100, no logins', () => {
  const ids = (count: number) => Array.from({ length: count }, (_, n) => String(n + 1)).join(',');
  const load = (value: string) => loadConfig({ DATABASE_URL, GITHUB_ALLOWED_ACCOUNT_IDS: value });
  expect(load(ids(100)).github.allowedAccountIds).toHaveLength(100);
  expect(() => load(ids(101))).toThrow(ConfigError);
  expect(() => load('octo-org')).toThrow(ConfigError);
  expect(install).toMatch(/at most 100 ids and no logins/);
});

test('it covers public and private Apps and the organisation that is admitted but has not installed the App', () => {
  const [several] = sectionsOf(install, 2).filter((section) => section.heading === 'Serving several organisations');
  expect(several?.body).toMatch(/\*\*Public or private App\.\*\*/);
  expect(several?.body).toMatch(/\*\*The instance's admission policy\.\*\*/);
  expect(several?.body).toMatch(/\*\*An organisation that is admitted but has not installed the App\.\*\*/);
  expect(several?.body).toContain('installation_not_admitted');
});

test('the log events and routes it cites exist in the server', () => {
  const source = ['src/server/domain/webhook-tenant.ts', 'src/shared/operator.ts', 'src/server/config/mode-log.ts']
    .map((file) => readText(path.join(ROOT, file)))
    .join('\n');
  for (const cited of ['installation_not_admitted', 'config.mode', '/api/operator/installations']) {
    expect(install).toContain(cited);
    expect(source, `${cited} is not in the server`).toContain(cited);
  }
});
