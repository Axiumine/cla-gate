// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { readText } from '../ci/lib/test-support.ts';
import { SHARD_NAMES } from './shards.ts';

// E20-S04: docs/quality-gates.md (Testing) has the shard table with the mutant counts and the measured times. A shard added
// to shards.ts without a row, or a row left behind for a shard that no longer exists, fails here.

const TABLE_START = '| Shard | Mutates |';
const text = readText('docs/quality-gates.md');
const lines = text.split('\n');
const start = lines.findIndex((line) => line.startsWith(TABLE_START));
const rows = lines
  .slice(start + 2)
  .join('\n')
  .split('\n\n')[0]
  ?.split('\n');

test('docs/quality-gates.md has the shard table', () => {
  expect(start).toBeGreaterThan(0);
  expect(lines[start + 1]).toMatch(/^\|(---\|)+$/);
  expect(rows?.length).toBeGreaterThan(1);
});

test('the shard table has exactly one row for every shard, in the order yarn mutate runs them', () => {
  const names = (rows ?? []).map((row) => /^\| `([^`]+)` \|/.exec(row)?.[1]);
  expect(names).toEqual([...SHARD_NAMES]);
});

test('every row of the shard table gives a mutant count', () => {
  for (const row of rows ?? []) {
    // The cells are: empty (before the first bar), shard, mutates, files, mutants, cold run, empty.
    const cells = row.split('|').map((cell) => cell.trim());
    expect(cells[4], row).toMatch(/^[1-9]\d{2}$/);
  }
});
