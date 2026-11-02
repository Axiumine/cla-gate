// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { readText } from '../ci/lib/test-support.ts';
import { ROOT } from '../semgrep-rules/test-support.ts';
import { SCRIPTS_SHARD, SHARD_NAMES } from './shards.ts';
import { mutated } from './test-support.ts';

// E20-S04: docs/quality-gates.md (Testing) has the shard table with the mutant counts and the measured times. A shard added
// to shards.ts without a row, a row left behind for a shard that no longer exists, and a Files cell that is not the number
// of files the shard's globs select on disk fail here. The mutant counts and the times are measurements (Stryker prints the
// counts before its initial test run), so nothing here can check them; they are checked by a person who changes the shards.

// The config is plain JavaScript outside this project, so a literal import would have no types.
// eslint-disable-next-line no-unsanitized/method -- the specifier is built from this repository's own root directory and a fixed file name
const loaded: unknown = await import(pathToFileURL(path.join(ROOT, 'stryker.config.mjs')).href);
const { strykerOptions } = z
  .object({
    strykerOptions: z.custom<(scope: string | undefined, shard?: string) => unknown>((v) => typeof v === 'function'),
  })
  .parse(loaded);

/** The files that the `mutate` globs of one shard (the scripts scope for `scripts`) select on disk. */
function filesOf(shard: string): string[] {
  const options = z
    .object({ mutate: z.array(z.string()) })
    .parse(shard === SCRIPTS_SHARD ? strykerOptions('scripts') : strykerOptions(undefined, shard));
  return mutated(options.mutate, ['src', 'scripts']);
}

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

test('the Files cell of every row is the number of files the shard selects on disk', () => {
  for (const row of rows ?? []) {
    const cells = row.split('|').map((cell) => cell.trim());
    const shard = /^`([^`]+)`$/.exec(cells[1] ?? '')?.[1] ?? '';
    expect(Number(cells[3]), `${shard}: ${row}`).toBe(filesOf(shard).length);
  }
});

test('the shards select files, so a Files cell of zero cannot pass', () => {
  for (const shard of SHARD_NAMES) {
    expect(filesOf(shard).length, shard).toBeGreaterThan(0);
  }
});
