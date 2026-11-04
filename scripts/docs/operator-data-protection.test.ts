// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { expect, test } from 'vitest';
import { ConfigError } from '../../src/server/config/config-error.ts';
import { loadConfig } from '../../src/server/config/env.ts';
import { readText } from '../ci/lib/test-support.ts';
import { codeBlocks, guide, ROOT, sectionsOf, serverSource, sourceFilesMentioning, tablesOf } from './test-support.ts';

// docs/operations/data-protection.md against the schema and the configuration (E19-S09): the retention table is the code's
// defaults and limits, what is stored is in the tables the migrations create, and the statements about features that are not
// built yet fail the day the feature lands, so the page is corrected with it.

const page = guide('data-protection');
const sections = sectionsOf(page, 2);
const sectionNamed = (heading: string) => sections.find((section) => section.heading === heading)?.body ?? '';
const DATABASE_URL = 'postgres://cla_app:made-up@db.example.test:5432/cla';
const initial = readText(path.join(ROOT, 'migrations/001_initial.sql'));
const retention = page.slice(page.indexOf('<!-- retention:start -->'), page.indexOf('<!-- retention:end -->'));
const [table] = tablesOf(retention);
const row = (data: string) => (table?.rows ?? []).find((cells) => cells[0]?.startsWith(data)) ?? [];
const configured = (env: Record<string, string> = {}) => loadConfig({ DATABASE_URL, ...env });

function refused(env: Record<string, string>): readonly string[] {
  try {
    configured(env);
  } catch (error) {
    if (error instanceof ConfigError) {
      return error.variables;
    }
    throw error;
  }
  return [];
}

test('the retention table is delimited by markers, has the four columns, and names every setting that exists', () => {
  expect(table?.rows).toHaveLength(6);
  expect(retention).toContain('| Data | Default | Limit | Setting |');
  expect(table?.separator).toBe('|---|---|---|---|');
  expect(page).toContain('The numbers here are checked against the code by a test');
});

test('network metadata: 30 days by default, from 1 to 90, as the table says', () => {
  expect(row('IP address')).toEqual([
    'IP address and user agent in `signer_pii`',
    '30 days',
    '90 days',
    '`NETWORK_METADATA_RETENTION_DAYS`',
  ]);
  expect(configured().networkMetadataRetentionDays).toBe(30);
  expect(configured({ NETWORK_METADATA_RETENTION_DAYS: '90' }).networkMetadataRetentionDays).toBe(90);
  expect(refused({ NETWORK_METADATA_RETENTION_DAYS: '91' })).toEqual(['NETWORK_METADATA_RETENTION_DAYS']);
  expect(refused({ NETWORK_METADATA_RETENTION_DAYS: '0' })).toEqual(['NETWORK_METADATA_RETENTION_DAYS']);
  expect(page).toContain('1 to 90 days, 30 by default');
});

test('sessions: eight hours idle, seven days absolute, and the idle lifetime cannot be above the absolute one', () => {
  expect(row('Session, idle')).toEqual([
    'Session, idle lifetime',
    '8 hours',
    'the absolute lifetime',
    '`SESSION_IDLE_SECONDS`',
  ]);
  expect(row('Session, absolute')).toEqual([
    'Session, absolute lifetime',
    '7 days',
    'none',
    '`SESSION_ABSOLUTE_SECONDS`',
  ]);
  expect(configured().session).toEqual({ idleSeconds: 8 * 3600, absoluteSeconds: 7 * 86_400 });
  expect(
    refused({ SESSION_IDLE_SECONDS: '1000', SESSION_ABSOLUTE_SECONDS: '900' }).toSorted((a, b) => a.localeCompare(b)),
  ).toEqual(['SESSION_ABSOLUTE_SECONDS', 'SESSION_IDLE_SECONDS']);
});

test('what is kept for ever is kept because the database refuses to change it: the core, the versions and the audit log', () => {
  for (const kept of ['Signatures and CLA versions', 'Audit log']) {
    expect(row(kept).slice(1)).toEqual(['indefinitely', 'none', 'none']);
  }
  expect(row('Name, email').slice(1)).toEqual(['until erased', 'none', 'none']);
  for (const trigger of [
    'cla_versions_immutable',
    'audit_log_immutable',
    'signatures_guard_update',
    'signatures_no_delete',
    'signatures_no_truncate',
  ]) {
    expect(initial.includes(`create trigger ${trigger} `), trigger).toBe(true);
  }
});

test('the tables it lists exist, and personal data is in signer_pii and users, not in the core or the audit log', () => {
  const [stored] = tablesOf(sectionNamed('What is stored'));
  const named = (stored?.rows ?? []).map((cells) => /`(\w+)`/.exec(cells[0] ?? '')?.[1]);
  expect(named).toEqual(['signatures', 'signer_pii', 'users', 'sessions', 'audit_log']);
  for (const name of named) {
    expect(initial.includes(`create table ${name} (`), name).toBe(true);
  }
  const core = /create table signatures \(([\s\S]*?)\n\);/.exec(initial)?.[1] ?? '';
  expect(core).not.toMatch(/\b(email|login|name)\b/);
  expect(initial).toMatch(/create table signer_pii \([\s\S]*?\bemail\b/);
});

test('the session cookie is stored as a hash, and no GitHub token of a user is stored', () => {
  expect(initial).toContain("session_hash         text not null unique check (session_hash ~ '^[0-9a-f]{64}$')");
  expect(sectionNamed('What is stored')).toContain('A hash of the session cookie');
  const columns = initial.match(/\b\w*token\w*\b/gi) ?? [];
  expect(columns.filter((word) => /access_token|refresh_token|github_token/i.test(word))).toEqual([]);
  expect(sectionNamed('What is stored')).toContain('never stores a GitHub token of a user');
});

test('the erasure function takes three arguments in the order the page gives, and the page names the replacement of the login', () => {
  const migration = readText(path.join(ROOT, 'migrations/009_erase_signer_pii_per_installation.sql'));
  expect(migration).toContain(
    'create function erase_signer_pii(p_github_id bigint, p_actor_github_id bigint, p_installation_id bigint) returns integer',
  );
  expect(migration).toContain("login = 'erased-' || github_id::text");
  expect(page).toContain('select erase_signer_pii(<github id>, <acting github id>, <installations.id>)');
  expect(page).toContain('`erased-<id>`');
  const [command] = codeBlocks(page, 'sh');
  expect(command?.text).toContain('docker compose exec -T postgres psql -U cla_owner -d cla -c');
});

test('the routes of the erasure and the access request exist, and privacy.md has the sections the page links to', () => {
  const source = serverSource();
  for (const route of ['/api/me/export', '/erasure-preview', '/erasures']) {
    expect(source, route).toContain(route);
    expect(page, route).toContain(route);
  }
  const privacy = readText(path.join(ROOT, 'docs/privacy.md'));
  expect(privacy).toMatch(/^#+ Erasure runbook$/m);
  expect(privacy).toMatch(/^#+ What stays, and why$/m);
});

test('the runtime role cannot delete or update signer_pii, so the function is the only way to remove a row', () => {
  const grants = readText(path.join(ROOT, 'migrations/001_initial.sql'));
  expect(grants).not.toMatch(/grant [^;]*\b(delete|update)\b[^;]* on signer_pii to cla_app/i);
  expect(page).toContain('the runtime role has no `delete` or `update` on the table');
});

test('features the page says are not built are not built: the recording switch is unknown to the server and the purge job is not scheduled', () => {
  expect(serverSource()).not.toContain('RECORD_NETWORK_METADATA');
  expect(page).toContain('`RECORD_NETWORK_METADATA`');
  expect(sourceFilesMentioning('PURGE_NETWORK_METADATA_JOB')).toEqual([
    'src/server/services/network-metadata-purge.ts',
  ]);
  expect(page).toContain('not yet scheduled (E16-S05 is open)');
});

test('the bundled proxy keeps no access log, and the page says the others may', () => {
  const caddyfile = readText(path.join(ROOT, 'docker/Caddyfile'));
  expect(caddyfile.split('\n').filter((line) => /^\s*log\b/.test(line))).toEqual([]);
  expect(page).toContain('The bundled Caddy keeps no access log');
  expect(page).toContain('access_log off;');
});

test('the notice checklist has nine items, and the backup duty has three', () => {
  expect(sectionNamed('The privacy notice you must provide').match(/^- /gm)).toHaveLength(9);
  const [backups] = sectionsOf(page, 2).filter((section) => section.heading === 'Backups hold erased data');
  expect(backups?.body.match(/^- \*\*/gm)).toHaveLength(3);
  expect(page).toContain('**It is not legal advice.**');
});
