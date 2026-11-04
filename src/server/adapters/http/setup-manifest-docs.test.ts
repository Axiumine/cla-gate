// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { APP_EVENTS, APP_PERMISSIONS, INSTALLATION_PERMISSIONS } from '../../../shared/github-app.ts';
import { buildAppManifest } from '../../domain/app-manifest.ts';
import { missingPermissions } from '../../domain/permissions.ts';

// E19-S06: the permissions and the events of the manifest are the ones of the settings table in docs/github-app.md, parsed
// from the file, so they cannot change without the reason recorded there (Rules).

const manifest = buildAppManifest({
  publicBaseUrl: 'https://cla.example.org',
  appName: 'CLA Gate',
  allowOtherAccounts: false,
});

/** The name GitHub's manifest uses for a permission, by the label the table gives it. */
const KEYS: ReadonlyMap<string, string> = new Map([
  ['Repository: Metadata', 'metadata'],
  ['Repository: Pull requests', 'pull_requests'],
  ['Repository: Checks', 'checks'],
  ['Repository: Issues', 'issues'],
  ['Organization: Members', 'members'],
  ['Account: Email addresses', 'emails'],
]);

/** The rows of the settings table, as the trimmed cells of each. */
function settingsRows(): string[][] {
  return readFileSync('docs/github-app.md', 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('| '))
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
}

/** The level a row grants: `write` for a value that starts with `write` or `read and write`, else `read`. */
function levelOf(value: string): string {
  return value.startsWith('write') || value.startsWith('read and write') ? 'write' : 'read';
}

/** The permissions the table lists as granted now: the rows that name a repository, an organisation or an account permission. */
function documentedPermissions(): Map<string, string> {
  const rows = settingsRows().filter(([label = '']) => /^(Repository|Organization|Account): /u.test(label));
  return new Map(
    rows.map(([label = '', value = '']) => {
      const key = KEYS.get(label);
      expect(
        key,
        `docs/github-app.md has a permission row "${label}" that this test has no manifest key for`,
      ).toBeDefined();
      return [key ?? label, levelOf(value)];
    }),
  );
}

/** The events the Events row subscribes to: the names in code spans before the ones that always arrive. */
function documentedEvents(): string[] {
  const row = settingsRows().find(([label]) => label === 'Events')?.[1];
  expect(row, 'docs/github-app.md has no `| Events |` row').toBeDefined();
  const [subscribed = ''] = (row ?? '').split('; `installation`');
  return [...subscribed.matchAll(/`([a-z_]+)`/gu)].map((match) => match[1] ?? '');
}

test('the permissions of the manifest are the permission rows of the table in docs/github-app.md, name and level', () => {
  const documented = Object.fromEntries(documentedPermissions());
  expect(manifest.default_permissions).toEqual(documented);
  expect(documented).toEqual({ ...APP_PERMISSIONS });
});

test('the events of the manifest are the events the Events row subscribes to', () => {
  expect(documentedEvents()).toEqual(['pull_request', 'check_run', 'check_suite', 'issue_comment']);
  expect(manifest.default_events).toEqual(documentedEvents());
  expect(manifest.default_events).toEqual([...APP_EVENTS]);
});

test('the check of the permissions an installation grants reads the same constants: the App as created grants enough, one less is named', () => {
  expect(missingPermissions({ ...INSTALLATION_PERMISSIONS })).toEqual([]);
  expect(missingPermissions(manifest.default_permissions)).toEqual([]);
  const withoutChecks = Object.fromEntries(
    Object.entries(manifest.default_permissions).filter(([name]) => name !== 'checks'),
  );
  expect(missingPermissions(withoutChecks)).toEqual(['checks']);
  expect(missingPermissions({ ...manifest.default_permissions, pull_requests: 'read' })).toEqual(['pull_requests']);
});
