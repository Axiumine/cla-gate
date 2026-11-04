// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { expect, test } from 'vitest';
import { readText } from '../ci/lib/test-support.ts';
import { readCompose, serviceNamed } from '../compose/test-support.ts';
import { codeBlocks, guide, headingsOf, inOrder, ROOT, sectionsOf, serverSource, slugOf } from './test-support.ts';

// docs/operations/uninstall.md against the stack and the server (E19-S09): the three meanings of uninstalling, the commands
// with the flags that keep or delete the volumes, and the facts about what the organisations see.

const uninstall = guide('uninstall');
const commands = codeBlocks(uninstall, 'sh')
  .map((block) => block.text)
  .join('\n');
const compose = readCompose();
const sections = sectionsOf(uninstall, 2);
const sectionNamed = (heading: string) => sections.find((section) => section.heading === heading)?.body ?? '';

test('the page separates stopping, removing the data, removing the platform, ending the App, and what the organisations see', () => {
  expect(sections.map((section) => section.heading)).toEqual([
    'Stop, keep everything',
    'Remove the data',
    'Remove the platform from the server',
    'End the GitHub App',
    'What the organisations see',
  ]);
  expect(uninstall).toContain('(#what-the-organisations-see)');
  expect(uninstall).toContain('(#stop-keep-everything)');
  expect(headingsOf(uninstall).map(slugOf)).toEqual(
    expect.arrayContaining(['what-the-organisations-see', 'stop-keep-everything']),
  );
});

test('stopping uses down with the profile and keeps the volumes; removing the data adds -v, and the page says what -v deletes', () => {
  expect(commands).toContain('docker compose --profile tls down\n');
  expect(commands).toContain('docker compose --profile tls down -v');
  expect(sectionNamed('Stop, keep everything')).toContain(
    'It keeps the volumes (`cla-postgres-data` with the database, `caddy-data` and `caddy-config` with the certificate)',
  );
  expect(Object.keys(compose.volumes).toSorted((a, b) => a.localeCompare(b))).toEqual([
    'caddy-config',
    'caddy-data',
    'cla-postgres-data',
  ]);
  expect(sectionNamed('Remove the data')).toMatch(
    /This destroys the database: every signature, every CLA version, the audit log and the job queue/,
  );
});

test('without the profile flag down leaves Caddy running, because the service is in the profile and nothing else is', () => {
  expect(serviceNamed(compose, 'caddy').profiles).toEqual(['tls']);
  for (const name of ['postgres', 'migrate', 'app']) {
    expect(serviceNamed(compose, name).profiles, name).toBeUndefined();
  }
  expect(sectionNamed('Stop, keep everything')).toContain(
    'Without the profile flag, `down` leaves the Caddy container running',
  );
  expect(sectionNamed('Stop, keep everything')).toContain('COMPOSE_PROFILES=tls');
});

test('the image it removes is the one the compose file builds, and the order of removal puts the organisations and the export first', () => {
  expect(serviceNamed(compose, 'app').image).toBe('cla-gate:local');
  expect(commands).toContain('docker image rm cla-gate:local');
  const [removal] = sections.filter((section) => section.heading === 'Remove the platform from the server');
  expect(
    inOrder(removal?.body ?? '', [
      '**Tell the organisations,**',
      '**Export** as above',
      '**End the GitHub App**',
      '**Remove the stack:**',
    ]),
  ).toBe(true);
});

test('the export it asks for is a route of the server, and the check it tells administrators to remove is the one the platform posts', () => {
  expect(uninstall).toContain('GET /api/installations/:installationId/documents/:documentId/signatures.csv');
  expect(serverSource()).toContain('/api/installations/:installationId/documents/:documentId/signatures.csv');
  expect(uninstall).toContain('`license/cla`');
  expect(serverSource()).toContain('license/cla');
});

test('an organisation that uninstalls is marked deleted and no longer served, and its signatures stay because the database refuses to delete them', () => {
  const initial = readText(path.join(ROOT, 'migrations/001_initial.sql'));
  expect(serverSource()).toContain("reason: 'installation_deleted'");
  expect(initial.includes('create trigger signatures_no_delete ')).toBe(true);
  expect(
    readText(path.join(ROOT, 'migrations/003_installation_repository_state.sql')).includes(
      'add column deleted_at timestamptz',
    ),
  ).toBe(true);
  expect(sectionNamed('End the GitHub App')).toContain('keeps its rows (signatures cannot be deleted)');
  expect(sectionNamed('End the GitHub App')).toContain('A private App that is deleted cannot be restored');
});

test('what the organisations see lists the five consequences, and the first one is the required check', () => {
  const body = sectionNamed('What the organisations see');
  expect(body.match(/^- \*\*/gm)).toHaveLength(5);
  expect(body).toMatch(/\*\*A required check keeps pull requests unmergeable\*\*/);
  expect(sectionNamed('Remove the platform from the server')).toMatch(/stays "expected" for ever and blocks merging/);
});

test('the page defers the data duties to data-protection.md and to the backups', () => {
  expect(uninstall).toContain('(data-protection.md#after-a-restore)');
  expect(uninstall).toContain('(backup-restore.md)');
  expect(sectionNamed('Remove the data')).toMatch(/Export first, and check what you exported/);
});
