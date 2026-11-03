// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { MIGRATIONS_DIRECTORY, migratedTestDatabase } from './test-support.ts';

// No legal text ships (E12-S01): a maintainer brings their own CLA. A fresh database holds no document, no version and no
// draft, and the repository holds no CLA wording as a seed, as a fixture outside the tests or as a default asset.

const ROOT = path.resolve(import.meta.dirname, '../../../..');

const tableName = z.object({ table_name: z.string() });
const rowCount = z.object({ n: z.number() });

test('after migrate, every table of the CLA documents (documents, versions, and the drafts once they exist) has no row', async () => {
  const { db } = await migratedTestDatabase();
  const { rows } = await sql`select table_name from information_schema.tables
    where table_schema = 'public' and table_name like 'cla\\_%' order by table_name`.execute(db);
  const tables = rows.map((row) => tableName.parse(row).table_name);
  expect(tables).toEqual(expect.arrayContaining(['cla_documents', 'cla_versions']));
  for (const table of tables) {
    const counted = await sql`select count(*)::int as n from ${sql.table(table)}`.execute(db);
    expect(rowCount.parse(counted.rows[0]).n, table).toBe(0);
  }
});

test('after migrate, no table that keeps what was signed or who signed holds a row either', async () => {
  const { db } = await migratedTestDatabase();
  for (const table of ['signatures', 'signer_pii', 'commit_overrides', 'allowlist_entries', 'pr_evaluations']) {
    const counted = await sql`select count(*)::int as n from ${sql.table(table)}`.execute(db);
    expect(rowCount.parse(counted.rows[0]).n, table).toBe(0);
  }
});

/** The files under `directory` that are product code or product data: not a test, not a helper of the tests. */
function shippedFiles(directory: string): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test: `directory` is a folder of this repository named by this file
  return fs
    .readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .filter((entry) => !/(?:\.test\.tsx?|test-support\.ts)$/.test(entry) && path.extname(entry) !== '')
    .map((entry) => path.join(directory, entry));
}

/** The words a grant of rights is made of: if one of them is in a shipped file, somebody shipped a CLA. */
const GRANT_WORDS = [
  /hereby\s+grants?/i,
  /perpetual,\s+worldwide/i,
  /royalty[- ]free/i,
  /irrevocabl[ey]/i,
  /sublicens/i,
];

test('no migration inserts into a table of the CLA documents', () => {
  const inserting = shippedFiles(MIGRATIONS_DIRECTORY).filter((file) =>
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- test: a migration file listed from this repository's own folder
    /insert\s+into\s+(?:public\.)?cla_/i.test(fs.readFileSync(file, 'utf8')),
  );
  expect(inserting).toEqual([]);
});

test('no file of the product and no migration holds the wording of a licence grant', () => {
  const files = [...shippedFiles(path.join(ROOT, 'src')), ...shippedFiles(MIGRATIONS_DIRECTORY)];
  expect(files.length).toBeGreaterThan(100);
  const found = files.flatMap((file) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- test: a file listed from this repository's own folders
    const text = fs.readFileSync(file, 'utf8');
    return GRANT_WORDS.filter((words) => words.test(text)).map(
      (words) => `${path.relative(ROOT, file)}: ${words.source}`,
    );
  });
  expect(found).toEqual([]);
});

test('the repository has no folder of seeds, fixtures or default assets for a CLA to sit in', () => {
  for (const folder of ['seeds', 'seed', 'fixtures', 'assets', 'public', 'templates', 'src/server/assets']) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- test: a folder name of this list under this repository's root
    expect(fs.existsSync(path.join(ROOT, folder)), folder).toBe(false);
  }
});
