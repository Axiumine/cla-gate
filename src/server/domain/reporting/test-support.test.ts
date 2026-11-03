// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  codePointCount,
  hasUnsafeCharacter,
  isOneCodeSpan,
  isOneLine,
  longestBackticks,
  outsideCodeSpans,
  showZeroWidth,
  unguardedMarks,
  ZWSP,
} from './test-support.ts';

// The checks of the reporting tests are themselves tested, so a check that passes everything cannot make a rendering test pass.

test.each([
  ['a plain span', '`a`', true],
  ['a longer fence', '``a`b``', true],
  ['a padded fence', '`` `a ``', true],
  ['no fence', 'a', false],
  ['a longer closing fence', '`a``', false],
  ['a shorter closing fence', '``a`', false],
  ['a run inside as long as the fence', '`a`b`', false],
  ['two spans', '`a` `b`', false],
])('isOneCodeSpan: %s', (_what, rendered, expected) => {
  expect(isOneCodeSpan(rendered)).toBe(expected);
});

test.each([
  ['nothing', '', 0],
  ['no backtick', 'abc', 0],
  ['one run', 'a``b', 2],
  ['the longest of several', '` ``` ``', 3],
])('longestBackticks: %s', (_what, text, expected) => {
  expect(longestBackticks(text)).toBe(expected);
});

test.each([
  ['a line feed', 'a\nb', false],
  ['a carriage return', 'a\rb', false],
  ['a next line', 'a\u0085b', false],
  ['a line separator', 'a\u{2028}b', false],
  ['a paragraph separator', 'a\u{2029}b', false],
  ['one line', 'a b', true],
])('isOneLine: %s', (_what, text, expected) => {
  expect(isOneLine(text)).toBe(expected);
});

test.each([
  ['a NUL', '\u0000', true],
  ['a unit separator', '\u001F', true],
  ['a space', ' ', false],
  ['DEL', '\u007F', true],
  ['a C1 control', '\u009F', true],
  ['the first character after the C1 controls', '\u{a0}', false],
  ['a line separator', '\u{2028}', true],
  ['a paragraph separator', '\u{2029}', true],
  ['the first bidi control', '\u{202a}', true],
  ['the bidi override', '\u{202e}', true],
  ['the first isolate', '\u{2066}', true],
  ['the last isolate', '\u{2069}', true],
  ['the character after the last isolate', '\u{206a}', false],
  ['an emoji', String.fromCodePoint(0x1f600), false],
])('hasUnsafeCharacter: %s', (_what, text, expected) => {
  expect(hasUnsafeCharacter(text)).toBe(expected);
});

test('unguardedMarks lists the marks with no zero-width space after them', () => {
  expect(unguardedMarks(`@${ZWSP}a @b #${ZWSP}1 #2`)).toEqual(['@', '#']);
  expect(unguardedMarks('plain')).toEqual([]);
});

test('codePointCount counts code points, not UTF-16 units', () => {
  expect(codePointCount(String.fromCodePoint(0x1f600).repeat(3))).toBe(3);
});

test('showZeroWidth names each zero-width space', () => {
  expect(showZeroWidth(`a${ZWSP}b${ZWSP}`)).toBe('a⟦ZWSP⟧b⟦ZWSP⟧');
});

test.each([
  ['no span', 'a < b', 'a < b'],
  ['one span', 'a `<b>` c', 'a  c'],
  ['two spans', '`<a>` and `<b>`', ' and '],
  ['a double fence that holds a single backtick', 'x ``a`<b>`` y', 'x  y'],
  ['a padded fence', 'x ```` ``` <a> ```` y', 'x  y'],
  ['a run with no closing run of the same length is plain text', 'a ``b` c', 'a ``b` c'],
  ['a span cut by a run of another length keeps looking', 'a ``b ` c`` d', 'a  d'],
  ['runs pair from the left, so a third single run stays', '` a `<b>`', '<b>`'],
  ['an empty text', '', ''],
])('outsideCodeSpans: %s', (_what, text, expected) => {
  expect(outsideCodeSpans(text)).toBe(expected);
});
