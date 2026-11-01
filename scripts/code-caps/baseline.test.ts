// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { compare, hasFailed, loadBaseline, ratcheted, writeBaseline } from './baseline.ts';
import { makeRepo, tempDir } from './test-support.ts';
import { BASELINE_NAME, CAPS, CapsError, type Kind, type Measure } from './types.ts';

function measure(kind: Kind, name: string, value: number): Measure {
  return { path: 'a.ts', line: 1, kind, name, value };
}

// --------------------------------------------------------------------------- compare

test('compare classifies new, grown, improved and fixed violations', () => {
  const current = [measure('function', 'new', 60), measure('function', 'grew', 70), measure('function', 'better', 55)];
  const baseline = new Map([
    ['a.ts::function::grew', 60],
    ['a.ts::function::better', 80],
    ['a.ts::function::gone', 90],
  ]);
  const verdict = compare(current, baseline);
  expect(verdict.added.map((item) => item.name)).toEqual(['new']);
  expect(verdict.grown.map(({ item, allowed }) => [item.name, allowed])).toEqual([['grew', 60]]);
  expect(verdict.improved).toEqual([{ key: 'a.ts::function::better', allowed: 80, now: 55 }]);
  expect(verdict.fixed).toEqual(['a.ts::function::gone']);
  expect(hasFailed(verdict)).toBe(true);
});

test('an equal violation passes', () => {
  const verdict = compare([measure('function', 'f', 60)], new Map([['a.ts::function::f', 60]]));
  expect(verdict).toEqual({ added: [], grown: [], improved: [], fixed: [] });
  expect(hasFailed(verdict)).toBe(false);
});

test('only a new or a grown violation fails', () => {
  const none = { added: [], grown: [], improved: [], fixed: [] };
  const grown = [{ item: measure('file', '-', 600), allowed: 500 }];
  expect(hasFailed({ ...none, added: [measure('file', '-', 600)] })).toBe(true);
  expect(hasFailed({ ...none, grown })).toBe(true);
  expect(hasFailed({ ...none, improved: [{ key: 'k', allowed: 2, now: 1 }], fixed: ['x'] })).toBe(false);
});

test('fixed keys are sorted', () => {
  const verdict = compare(
    [],
    new Map([
      ['b', 1],
      ['a', 1],
      ['c', 1],
    ]),
  );
  expect(verdict.fixed).toEqual(['a', 'b', 'c']);
});

// --------------------------------------------------------------------------- ratchet

test('the ratchet only lowers and never adds', () => {
  const current = [measure('function', 'f', 55), measure('function', 'added', 99), measure('function', 'up', 90)];
  const baseline = new Map([
    ['a.ts::function::f', 70],
    ['a.ts::function::up', 60],
    ['a.ts::function::fixed', 80],
  ]);
  expect(ratcheted(current, baseline)).toEqual(
    new Map([
      ['a.ts::function::f', 55],
      ['a.ts::function::up', 60],
    ]),
  );
});

// --------------------------------------------------------------------------- file format

test('a missing baseline is empty', () => {
  expect(loadBaseline(path.join(tempDir(), BASELINE_NAME))).toEqual(new Map());
});

test('the baseline round-trips, sorted, with the caps and version', () => {
  const file = path.join(tempDir(), BASELINE_NAME);
  writeBaseline(
    file,
    new Map([
      ['b', 2],
      ['a', 1],
      ['c', 3],
    ]),
  );
  expect(loadBaseline(file)).toEqual(
    new Map([
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ]),
  );
  const text = fs.readFileSync(file, 'utf8');
  const parsed: unknown = JSON.parse(text);
  expect(text.endsWith('}\n')).toBe(true);
  expect(parsed).toMatchObject({ version: 1, caps: CAPS, violations: { a: 1, b: 2, c: 3 } });
  expect([...text.matchAll(/"([abc])": \d/g)].map((match) => match[1])).toEqual(['a', 'b', 'c']);
});

test('an empty baseline is written like the committed one', () => {
  const file = path.join(tempDir(), BASELINE_NAME);
  writeBaseline(file, new Map());
  const expected = `{\n  "version": 1,\n  "caps": {\n    "file": 500,\n    "function": 50,\n    "class": 300,\n    "params": 4,\n    "nesting": 4\n  },\n  "violations": {}\n}\n`;
  expect(fs.readFileSync(file, 'utf8')).toBe(expected);
});

test.each<[string, string]>([
  ['not an object', '[]'],
  ['null', 'null'],
  ['a string', '"x"'],
  ['no violations key', '{}'],
  ['violations is a list', '{"violations": []}'],
  ['a non-number value', '{"violations": {"a": "x"}}'],
  ['a fractional value', '{"violations": {"a": 1.5}}'],
])('rejects a corrupt baseline: %s', (_label, text) => {
  const root = tempDir();
  makeRepo(root, { [BASELINE_NAME]: text });
  expect(() => loadBaseline(path.join(root, BASELINE_NAME))).toThrow(
    `${BASELINE_NAME} is not a valid code-caps baseline`,
  );
});

test('a baseline that is not JSON is reported with its file name', () => {
  const root = tempDir();
  makeRepo(root, { [BASELINE_NAME]: '\uFEFF{}' });
  const read = (): unknown => loadBaseline(path.join(root, BASELINE_NAME));
  expect(read).toThrow(CapsError);
  expect(read).toThrow(`${BASELINE_NAME}: SyntaxError`);
});

test('writing replaces the baseline atomically and leaves no temporary file', () => {
  const root = tempDir();
  const file = path.join(root, BASELINE_NAME);
  writeBaseline(file, new Map([['a', 1]]));
  writeBaseline(file, new Map([['b', 2]]));
  expect(loadBaseline(file)).toEqual(new Map([['b', 2]]));
  expect(fs.readdirSync(root)).toEqual([BASELINE_NAME]);
});
