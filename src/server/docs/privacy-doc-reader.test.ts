// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { migratedTestDatabase } from '../adapters/db/test-support.ts';
import {
  cellsOf,
  durationSeconds,
  liveColumns,
  markedTable,
  readPrivacyDoc,
  unquote,
} from './privacy-doc/test-support.ts';

// The reader that the checks of docs/privacy.md stand on (E16-S07). A reader that skipped a table or read a half-written one
// would let the document drift while every check stayed green, so what it refuses is pinned here.

const TABLE = [
  'Intro text that is not part of the table.',
  '<!-- sample:start -->',
  'A sentence between the marker and the table is ignored.',
  '| Column | Purpose |',
  '|---|---|',
  '| `users.login` | Display |',
  '|  `signer_pii.email`  |  Evidence  |',
  '<!-- sample:end -->',
  'Text after the table.',
].join('\n');

test('a marked table is read as its header, its separator and one array of cells per row', () => {
  expect(markedTable(TABLE, 'sample')).toEqual({
    header: '| Column | Purpose |',
    separator: '|---|---|',
    rows: [
      ['`users.login`', 'Display'],
      ['`signer_pii.email`', 'Evidence'],
    ],
  });
});

test('a table with a header and a separator and no row has no rows', () => {
  const text = '<!-- empty:start -->\n| A |\n|---|\n<!-- empty:end -->';
  expect(markedTable(text, 'empty').rows).toEqual([]);
});

test.each([
  ['both markers are missing', 'no markers at all'],
  ['the start marker is missing', '| A |\n|---|\n<!-- sample:end -->'],
  ['the end marker is missing', '<!-- sample:start -->\n| A |\n|---|'],
  ['the start marker is written twice', `<!-- sample:start -->\n${TABLE}`],
  ['the end marker is written twice', `${TABLE}\n<!-- sample:end -->`],
])('a document where %s is refused, so a renamed marker is never read as an empty table', (_label, text) => {
  expect(() => markedTable(text, 'sample')).toThrow('must each appear exactly once');
});

test.each([
  ['nothing between the markers', '<!-- sample:start --><!-- sample:end -->'],
  ['only a header line', '<!-- sample:start -->\n| A |\n<!-- sample:end -->'],
  ['text and no table', '<!-- sample:start -->\nA paragraph.\n<!-- sample:end -->'],
])('%s is refused as a table', (_label, text) => {
  expect(() => markedTable(text, 'sample')).toThrow('no table between');
});

test('the cells of a line are trimmed and a code span loses its backticks', () => {
  expect(cellsOf('  | a |  `b.c`  | d e |  ')).toEqual(['a', '`b.c`', 'd e']);
  expect(unquote('`b.c`')).toBe('b.c');
});

test.each([
  ['30 days', 2_592_000],
  ['8 hours', 28_800],
  ['7 days', 604_800],
])('%s is %d seconds', (text, seconds) => {
  expect(durationSeconds(text)).toBe(seconds);
});

test.each(['30', 'days', '30 weeks', 'x days', '3.5 days', '-3 days', '30 constructor', ''])(
  'the duration "%s" is refused',
  (text) => {
    expect(() => durationSeconds(text)).toThrow('not a duration the document uses');
  },
);

test('the live columns are table.column names of the application tables, without the migration ledger', async () => {
  const { db } = await migratedTestDatabase();
  const columns = await liveColumns(db);
  expect(columns).toContain('users.login');
  expect(columns).toContain('signer_pii.email');
  expect(columns).toEqual(columns.toSorted((a, b) => a.localeCompare(b)));
  expect(columns.filter((name) => name.startsWith('schema_migrations.'))).toEqual([]);
});

test('the privacy notes can be read from the docs folder', () => {
  expect(readPrivacyDoc()).toContain('# Privacy notes');
});
