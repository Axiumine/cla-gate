// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { HOSTILE_CONTROL_NAMES, HOSTILE_NAMES } from '../../shared/hostile-names.ts';
import { encodeCsvCell, encodeCsvRow, neutraliseFormula } from './csv.ts';
import { parseCsv } from './csv-fixture/test-support.ts';

// The CSV encoder of the signature export (E16-S03): RFC 4180 and the guard against formulas, on cells alone.

const TRIGGERS = [
  ['the equals sign', '='],
  ['the plus sign', '+'],
  ['the minus sign', '-'],
  ['the at sign', '@'],
  ['a tab', '\t'],
  ['a carriage return', '\r'],
] as const;

test.each(TRIGGERS)('a cell that begins with %s gets one single quote in front of it', (_name, trigger) => {
  expect(neutraliseFormula(`${trigger}SUM(A1)`)).toBe(`'${trigger}SUM(A1)`);
  expect(parseCsv(encodeCsvRow([`${trigger}x`]))).toEqual([[`'${trigger}x`]]);
});

test.each(TRIGGERS)('a cell that is only %s is guarded too', (_name, trigger) => {
  expect(neutraliseFormula(trigger)).toBe(`'${trigger}`);
});

test.each([
  ['an empty cell', ''],
  ['a word', 'Ada'],
  ['a trigger inside the cell', 'a=b+c-d@e'],
  ['a space in front of a trigger', ' =1+1'],
  ['a quote already in front', "'=1"],
  ['a line feed in front', '\n=1'],
  ['a digit', '42'],
])('%s is not changed by the guard', (_name, cell) => {
  expect(neutraliseFormula(cell)).toBe(cell);
});

test.each([
  ['a comma', 'a,b', '"a,b"'],
  ['a double quote', 'say "hi"', '"say ""hi"""'],
  ['a line feed', 'a\nb', '"a\nb"'],
  ['a carriage return inside', 'a\rb', '"a\rb"'],
  ['a comma, a double quote and a line break together', 'a,"b"\nc', '"a,""b""\nc"'],
  ['a trigger carriage return, which needs quotes after the guard', '\rx', '"\'\rx"'],
  ['a guarded cell that also has a comma', '=1,2', '"\'=1,2"'],
  ['nothing special', 'plain text', 'plain text'],
  ['a tab inside', 'a\tb', 'a\tb'],
  ['a tab in front, guarded and not quoted', '\tb', "'\tb"],
  ['the empty string', '', ''],
])('a cell with %s is written as %j', (_name, cell, written) => {
  expect(encodeCsvCell(cell)).toBe(written);
});

test('a row ends with CRLF, the last row too, and its cells are separated by commas', () => {
  expect(encodeCsvRow(['a', '', 'c'])).toBe('a,,c\r\n');
  expect(encodeCsvRow(['only'])).toBe('only\r\n');
  expect(encodeCsvRow(['a,b', 'c']) + encodeCsvRow(['d', 'e'])).toBe('"a,b",c\r\nd,e\r\n');
  expect(encodeCsvRow([])).toBe('\r\n');
});

test('the text is plain characters: no byte order mark in front of the first cell', () => {
  expect(encodeCsvRow(['a']).codePointAt(0)).toBe('a'.codePointAt(0));
  expect(Buffer.from(encodeCsvRow(['é'])).subarray(0, 2)).toEqual(Buffer.from([0xc3, 0xa9]));
});

const CORPUS = [...HOSTILE_NAMES, ...HOSTILE_CONTROL_NAMES];

test.each(CORPUS.map((name) => [name.slice(0, 40), name] as const))(
  'the hostile name %j survives the round trip, begins no cell with a trigger and is one cell',
  (_label, name) => {
    const rows = parseCsv(encodeCsvRow(['id', name, 'x']));
    expect(rows).toHaveLength(1);
    const [cells] = rows;
    expect(cells).toHaveLength(3);
    expect(cells?.[1]).toBe(neutraliseFormula(name));
    expect(TRIGGERS.map(([, trigger]) => cells?.[1]?.startsWith(trigger))).not.toContain(true);
  },
);

test('a name with a comma, a double quote and a line break in it stays one cell and is read back whole', () => {
  const name = 'Smith, "Ada"\nLovelace';
  expect(encodeCsvRow([name])).toBe('"Smith, ""Ada""\nLovelace"\r\n');
  expect(parseCsv(encodeCsvRow(['a', name, 'b']))).toEqual([['a', name, 'b']]);
});

test.each([
  ['an email local part that begins with a plus sign', '+tag@example.test'],
  ['an email local part that begins with a minus sign', '-tag@example.test'],
])('%s is guarded', (_name, email) => {
  expect(parseCsv(encodeCsvRow([email]))).toEqual([[`'${email}`]]);
});

test.each([
  ['a row without its CRLF', 'a,b'],
  ['a quote that opens in the middle of a field', 'a"b",c\r\n'],
  ['a quote that is never closed', '"a,b\r\n'],
  ['a bare line feed as the line end', 'a,b\n'],
])('the strict reader of the tests refuses %s', (_name, text) => {
  expect(() => parseCsv(text)).toThrow('not RFC 4180 at character');
});

test('the strict reader reads several rows, empty cells and an empty text', () => {
  expect(parseCsv('a,,c\r\n,\r\n"x""y",z\r\n')).toEqual([
    ['a', '', 'c'],
    ['', ''],
    ['x"y', 'z'],
  ]);
  expect(parseCsv('')).toEqual([]);
});
