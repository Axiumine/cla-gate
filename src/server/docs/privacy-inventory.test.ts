// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { migratedTestDatabase } from '../adapters/db/test-support.ts';
import {
  liveColumns,
  markedTable,
  PERSONAL_COLUMN_PATTERN,
  readPrivacyDoc,
  unquote,
} from './privacy-doc/test-support.ts';

// The data inventory of docs/privacy.md against the live schema (E16-S07). The inventory has one row per column that holds
// personal data; a column that looks personal and is in neither the inventory nor NOT_PERSONAL fails here, so the next epic
// that adds one cannot forget to say what it is for, who sees it, how long it is kept and whether erasure reaches it.

/** The columns whose names match the pattern and that are not about a signer, each with the reason. */
const NOT_PERSONAL: Readonly<Record<string, string>> = {
  'installations.account_login':
    'login of the organisation or account that installed the App, public on GitHub, not a signer',
  'repositories.full_name':
    'owner/name of a repository the maintainers installed the App on, public on GitHub, not a signer',
  'cla_documents.name': 'title of a CLA document chosen by the maintainers, not a signer',
};

/**
 * Columns the inventory describes before the migration that adds them exists, each with the story that adds it. The erasure
 * (E16-S04) and the purge (E16-S05) already look for them in the catalogue. A name that is live leaves this map (the
 * second test below fails until it does), so the map only ever shrinks.
 */
const PLANNED_COLUMNS: Readonly<Record<string, string>> = {};

/** The columns the story names; the document may list more, never fewer. */
const REQUIRED = [
  'users.login',
  'users.name',
  'users.avatar_url',
  'signer_pii.name',
  'signer_pii.email',
  'signer_pii.login',
  'signer_pii.ip_address',
  'signer_pii.user_agent',
  'allowlist_entries.login_snapshot',
  'sessions.verified_emails',
];

const table = markedTable(readPrivacyDoc(), 'inventory');
const documented = table.rows.map((cells) => unquote(cells[0] ?? ''));
const isListed = (name: string): boolean => documented.includes(name) || Object.hasOwn(NOT_PERSONAL, name);

test('the inventory has the header and the separator the story fixes', () => {
  expect(table.header).toBe('| Column | Purpose | Visible to | Retention | Erasable |');
  expect(table.separator).toBe('|---|---|---|---|---|');
});

test('every row of the inventory has five filled cells, and says whether erasure reaches the column', () => {
  expect(table.rows.map((cells) => cells.length)).toEqual(table.rows.map(() => 5));
  expect(table.rows.flat().filter((cell) => cell === '')).toEqual([]);
  expect(table.rows.map((cells) => /^(Yes|No)\b/.test(cells[4] ?? ''))).toEqual(table.rows.map(() => true));
});

test('the inventory names a column once, as table.column', () => {
  expect(documented.filter((name) => !/^[a-z_]+\.[a-z_]+$/.test(name))).toEqual([]);
  expect(new Set(documented).size).toBe(documented.length);
});

test('the inventory has a row for each personal-data column the story names', () => {
  expect(REQUIRED.filter((name) => !documented.includes(name))).toEqual([]);
});

test('a live column whose name suggests a person is in the inventory or in NOT_PERSONAL', async () => {
  const { db } = await migratedTestDatabase();
  const unlisted = (await liveColumns(db)).filter((name) => PERSONAL_COLUMN_PATTERN.test(name) && !isListed(name));
  expect(unlisted, 'add each column to the inventory of docs/privacy.md, or to NOT_PERSONAL with the reason').toEqual(
    [],
  );
});

test('every column of the inventory exists, except the ones a later story adds, and those do not exist yet', async () => {
  const { db } = await migratedTestDatabase();
  const live = new Set(await liveColumns(db));
  expect(documented.filter((name) => !live.has(name) && !Object.hasOwn(PLANNED_COLUMNS, name))).toEqual([]);
  expect(
    Object.keys(PLANNED_COLUMNS).filter((name) => live.has(name)),
    'the column exists now: drop it from PLANNED_COLUMNS',
  ).toEqual([]);
});

test('every planned column is described by the inventory and has a reason', () => {
  expect(Object.keys(PLANNED_COLUMNS).filter((name) => !documented.includes(name))).toEqual([]);
  expect(Object.values(PLANNED_COLUMNS).filter((reason) => reason === '')).toEqual([]);
});

test('NOT_PERSONAL holds live columns that the pattern catches, none of them in the inventory, each with a reason', async () => {
  const { db } = await migratedTestDatabase();
  const live = new Set(await liveColumns(db));
  const names = Object.keys(NOT_PERSONAL);
  expect(names.filter((name) => !live.has(name))).toEqual([]);
  expect(names.filter((name) => !PERSONAL_COLUMN_PATTERN.test(name))).toEqual([]);
  expect(names.filter((name) => documented.includes(name))).toEqual([]);
  expect(Object.values(NOT_PERSONAL).filter((reason) => reason === '')).toEqual([]);
});
