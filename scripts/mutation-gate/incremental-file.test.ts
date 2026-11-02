// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { expect, test } from 'vitest';
import { collectIo, exists, readText } from '../ci/lib/test-support.ts';
import { makeRepo, tempDir } from '../code-caps/test-support.ts';
import { isReadable, runCheckIncremental } from './incremental-file.ts';
import { incrementalFileOf, SHARD_NAMES } from './shards.ts';

// E20-S04: a truncated or broken incremental file stops every Stryker run at start-up (its project reader rethrows each
// error but "no such file"), and the CI job saves the file after the run, also after a stop. The check deletes a file
// Stryker cannot read before the cache can keep it.

const place = { start: { line: 3, column: 5 }, end: { line: 3, column: 12 } };
const mutant = { id: '0', mutatorName: 'StringLiteral', replacement: '""', status: 'Killed', location: place };
const test1 = { id: 'src/a.test.ts#1', name: 'a works', location: { start: { line: 1, column: 1 } } };
/** An incremental report of the shape Stryker writes, as text. */
const report = (parts: Record<string, unknown> = {}) =>
  JSON.stringify({
    schemaVersion: '2',
    thresholds: { high: 95, low: 90 },
    files: { 'src/a.ts': { language: 'typescript', source: 'x', mutants: [mutant] } },
    testFiles: { 'src/a.test.ts': { tests: [test1] } },
    ...parts,
  });

test('a report of the shape Stryker writes is readable, with or without test files and test locations', () => {
  expect(isReadable(report())).toBe(true);
  expect(isReadable(report({ testFiles: undefined }))).toBe(true);
  expect(isReadable(report({ testFiles: { 'src/a.test.ts': { tests: [{ id: '1', name: 'a works' }] } } }))).toBe(true);
  expect(isReadable(report({ files: {} }))).toBe(true);
});

test.each([
  ['an empty file', ''],
  ['a report cut short in the middle of a mutant', report().slice(0, 200)],
  ['a report cut short just before its last brace', report().slice(0, -1)],
  ['text that is not JSON', 'not json'],
  ['null', 'null'],
  ['an array', '[]'],
  ['an object without files', '{}'],
  ['files that is not an object', report({ files: [] })],
  ['a file without mutants', report({ files: { 'src/a.ts': {} } })],
  ['a mutant without a location', report({ files: { 'src/a.ts': { mutants: [{ id: '0' }] } } })],
  [
    'a mutant location without an end',
    report({ files: { 'src/a.ts': { mutants: [{ location: { start: place.start } }] } } }),
  ],
  [
    'a mutant position without a column',
    report({ files: { 'src/a.ts': { mutants: [{ location: { start: { line: 1 }, end: place.end } }] } } }),
  ],
  ['a test file without tests', report({ testFiles: { 'src/a.test.ts': {} } })],
  ['a test location without a start', report({ testFiles: { 'src/a.test.ts': { tests: [{ location: {} }] } } })],
])('%s is not readable, because Stryker would stop at start-up on it', (_name, text) => {
  expect(isReadable(text)).toBe(false);
});

/** A repository root with the incremental files `files` (shard name to text). */
function rootWith(files: Record<string, string>): string {
  const root = tempDir();
  makeRepo(root, Object.fromEntries(Object.entries(files).map(([shard, text]) => [incrementalFileOf(shard), text])));
  return root;
}

test('a readable file is kept as it is', () => {
  const root = rootWith({ shared: report() });
  const { io, out, err } = collectIo();
  expect(runCheckIncremental({ STRYKER_SHARD: 'shared' }, io, root)).toBe(0);
  expect(readText(path.join(root, incrementalFileOf('shared')))).toBe(report());
  expect(out).toEqual(['reports/stryker-incremental-shared.json: readable, kept']);
  expect(err).toEqual([]);
});

test('a file that is not there is nothing to check, and nothing is created', () => {
  const root = tempDir();
  const { io, out } = collectIo();
  expect(runCheckIncremental({ STRYKER_SHARD: 'db' }, io, root)).toBe(0);
  expect(exists(path.join(root, 'reports'))).toBe(false);
  expect(out).toEqual(['reports/stryker-incremental-db.json: no file, nothing to check']);
});

test('a truncated file is deleted with a warning annotation, so that the cache step has nothing broken to keep', () => {
  const root = rootWith({ 'http-a-v': report().slice(0, 150) });
  const { io, out, err } = collectIo();
  expect(runCheckIncremental({ STRYKER_SHARD: 'http-a-v' }, io, root)).toBe(0);
  expect(exists(path.join(root, incrementalFileOf('http-a-v')))).toBe(false);
  expect(out).toHaveLength(1);
  expect(out[0]).toMatch(
    /^::warning title=Stryker incremental file::reports\/stryker-incremental-http-a-v\.json is not a /,
  );
  expect(err).toEqual([]);
});

test('a file that parses but lacks what the reader needs is deleted too', () => {
  const root = rootWith({ config: '{}' });
  const { io } = collectIo();
  expect(runCheckIncremental({ STRYKER_SHARD: 'config' }, io, root)).toBe(0);
  expect(exists(path.join(root, incrementalFileOf('config')))).toBe(false);
});

test('the scripts shard has its own file, and only the file of the named shard is looked at', () => {
  const root = rootWith({ scripts: 'broken', config: 'broken', shared: report() });
  const { io } = collectIo();
  expect(runCheckIncremental({ STRYKER_SHARD: 'scripts' }, io, root)).toBe(0);
  expect(exists(path.join(root, 'reports/stryker-incremental-scripts.json'))).toBe(false);
  expect(exists(path.join(root, 'reports/stryker-incremental-config.json'))).toBe(true);
  expect(exists(path.join(root, 'reports/stryker-incremental-shared.json'))).toBe(true);
});

test.each([[undefined], [''], ['sharedd'], ['Shared'], ['../shared'], ['shared '], ['all']])(
  'STRYKER_SHARD=%j is an error that names the shards, and no file is touched',
  (shard) => {
    const root = rootWith({ shared: 'broken' });
    const { io, out, err } = collectIo();
    expect(runCheckIncremental({ STRYKER_SHARD: shard }, io, root)).toBe(2);
    expect(exists(path.join(root, incrementalFileOf('shared')))).toBe(true);
    expect(out).toEqual([]);
    expect(err).toEqual([`STRYKER_SHARD must be one of ${SHARD_NAMES.join(', ')}, not ${JSON.stringify(shard ?? '')}`]);
  },
);

test('every shard of the gate can be checked', () => {
  for (const shard of SHARD_NAMES) {
    const root = rootWith({ [shard]: 'broken' });
    expect(runCheckIncremental({ STRYKER_SHARD: shard }, collectIo().io, root), shard).toBe(0);
    expect(exists(path.join(root, incrementalFileOf(shard))), shard).toBe(false);
  }
});

test('a failure other than a missing file is not hidden: a directory where the file should be stops the step', () => {
  const root = rootWith({});
  makeRepo(root, { [`${incrementalFileOf('shared')}/inner.json`]: '{}' });
  expect(() => runCheckIncremental({ STRYKER_SHARD: 'shared' }, collectIo().io, root)).toThrow(/EISDIR/);
});
