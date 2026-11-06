// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { type DiffLine, diffOf, foldRuns, isIdentical, MAX_EDITS, MAX_UNFOLDED_RUN } from './line-diff.ts';

// E18-S11: the line diff of two versions, computed in the browser from their two texts. The texts are canonical (LF, a final line feed).

/** The kind and text of each line, without its place. */
const shape = (lines: readonly DiffLine[]) => lines.map(({ kind, text }) => [kind, text]);

/** `count` lines `Zzzz line 1` ... `Zzzz line <count>`, each ending in a line feed. */
const lines = (count: number, word = 'Zzzz') =>
  Array.from({ length: count }, (_, index) => `${word} line ${String(index + 1)}\n`).join('');

test('a line that only the older text has is removed, a line that only the newer one has is added, and the rest is unchanged, in reading order', () => {
  expect(shape(diffOf('one\ntwo\nthree\n', 'one\n2\nthree\nfour\n'))).toEqual([
    ['same', 'one'],
    ['removed', 'two'],
    ['added', '2'],
    ['same', 'three'],
    ['added', 'four'],
  ]);
});

test('every line carries its place in the diff, from 0, which is a key that is the same on every render', () => {
  expect(diffOf('a\nb\n', 'a\nc\n').map((line) => line.at)).toEqual([0, 1, 2]);
});

test('identical texts are all unchanged lines and are told to be identical', () => {
  const same = diffOf('a\n\nb\n', 'a\n\nb\n');
  expect(shape(same)).toEqual([
    ['same', 'a'],
    ['same', ''],
    ['same', 'b'],
  ]);
  expect(isIdentical(same)).toBe(true);
});

test('two empty texts have no lines and are identical', () => {
  expect(diffOf('', '')).toEqual([]);
  expect(isIdentical([])).toBe(true);
});

test('an empty line is a line, and the line feed that ends a text is not an extra empty line', () => {
  expect(shape(diffOf('a\n', 'a\n\n'))).toEqual([
    ['same', 'a'],
    ['added', ''],
  ]);
});

test('a text without a final line feed still has its last line', () => {
  expect(shape(diffOf('a\nb', 'a\nc'))).toEqual([
    ['same', 'a'],
    ['removed', 'b'],
    ['added', 'c'],
  ]);
});

test('a change in the text is a difference, whatever the kind of change', () => {
  expect(isIdentical(diffOf('a\n', 'b\n'))).toBe(false);
  expect(isIdentical(diffOf('a\n', ''))).toBe(false);
  expect(isIdentical(diffOf('', 'a\n'))).toBe(false);
});

test('text that looks like markup or a diff header is a line like any other, never read', () => {
  expect(shape(diffOf('+ <script>alert(1)</script>\n', '--- a/b\n'))).toEqual([
    ['removed', '+ <script>alert(1)</script>'],
    ['added', '--- a/b'],
  ]);
});

test('texts further apart than the search goes are shown as all removed, then all added, even for the line they share', () => {
  const half = MAX_EDITS / 2 + 1;
  const result = diffOf(`${lines(half, 'Old')}shared\n`, `${lines(half, 'New')}shared\n`);
  expect(result).toHaveLength(2 * half + 2);
  expect(result.slice(0, half + 1).every((line) => line.kind === 'removed')).toBe(true);
  expect(result.slice(half + 1).every((line) => line.kind === 'added')).toBe(true);
  expect(result.map((line) => line.at)).toEqual(Array.from({ length: 2 * half + 2 }, (_, index) => index));
});

test('texts just within the search keep the line they share as unchanged', () => {
  const half = MAX_EDITS / 2;
  const result = diffOf(`${lines(half, 'Old')}shared\n`, `${lines(half, 'New')}shared\n`);
  expect(result.filter((line) => line.kind === 'same')).toEqual([{ kind: 'same', text: 'shared', at: 2 * half }]);
});

test('a run of unchanged lines of at most six stays as lines, and one of seven is folded into one group', () => {
  const six = foldRuns(diffOf(`${lines(MAX_UNFOLDED_RUN)}x\n`, `${lines(MAX_UNFOLDED_RUN)}y\n`));
  expect(six.map((item) => item.type)).toEqual(Array.from({ length: MAX_UNFOLDED_RUN + 2 }, () => 'line'));
  const seven = foldRuns(diffOf(`${lines(MAX_UNFOLDED_RUN + 1)}x\n`, `${lines(MAX_UNFOLDED_RUN + 1)}y\n`));
  expect(seven.map((item) => item.type)).toEqual(['folded', 'line', 'line']);
  const group = seven[0];
  expect(group?.type === 'folded' && group.lines).toHaveLength(MAX_UNFOLDED_RUN + 1);
});

test('a folded group says where it starts, and runs before, between and after the changes fold on their own', () => {
  const body = lines(8);
  const items = foldRuns(diffOf(`${body}x\n${body}y\n${body}`, `${body}1\n${body}2\n${body}`));
  expect(items.map((item) => item.type)).toEqual(['folded', 'line', 'line', 'folded', 'line', 'line', 'folded']);
  expect(items.flatMap((item) => (item.type === 'folded' ? [item.at] : []))).toEqual([0, 10, 20]);
});

test('changed lines are never folded, and a text with nothing unchanged has no group', () => {
  expect(foldRuns(diffOf(lines(10, 'Old'), lines(10, 'New'))).every((item) => item.type === 'line')).toBe(true);
  expect(foldRuns([])).toEqual([]);
});
