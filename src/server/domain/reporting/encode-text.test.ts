// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { neutraliseText } from './encode.ts';
import { ZWSP } from './test-support.ts';

// E09-S01, neutraliseText: free text that is not a name (the advisory text of a trailer). Line breaks become spaces, the text
// is cut to 200 code points, and every Markdown punctuation character is escaped and every @ and # followed by U+200B.

const FFFD = '\u{fffd}';
const EMOJI = String.fromCodePoint(0x1f600);

/** The character of a code point, written as a number: a tag character is invisible, so in a file it would be too. */
const tag = (codePoint: number): string => String.fromCodePoint(codePoint);

/** The eighteen characters of the Markdown punctuation set, in the order of the story, one per test row. */
const PUNCTUATION = ['\\', '`', '*', '_', '[', ']', '(', ')', '<', '>', '#', '+', '-', '.', '!', '|', '~', '&'];

test.each(PUNCTUATION)('neutraliseText puts a backslash before %s', (character) => {
  const mark = character === '#' ? ZWSP : '';
  expect(neutraliseText(`a${character}b`)).toBe(`a\\${character}${mark}b`);
});

test('the punctuation set has eighteen characters and nothing is escaped twice', () => {
  expect(new Set(PUNCTUATION).size).toBe(18);
  expect(neutraliseText('\\\\')).toBe('\\\\\\\\');
});

test('text with none of those characters is left as it is', () => {
  const plain = 'Jane Doe, 3 of 4: "fixes" a/b = c? {d} $e %f ^g \'h\' ;i';
  expect(neutraliseText(plain)).toBe(plain);
});

test.each([
  ['an @', 'ping @octocat now', `ping @${ZWSP}octocat now`],
  ['a #', 'see #12', `see \\#${ZWSP}12`],
  ['an email-shaped text', 'a@b.co', `a@${ZWSP}b\\.co`],
  ['a link', '[x](http://evil.example)', '\\[x\\]\\(http://evil\\.example\\)'],
  ['an image', '![i](http://t.example/p.png)', '\\!\\[i\\]\\(http://t\\.example/p\\.png\\)'],
  ['a tag', '<b>x</b>', '\\<b\\>x\\</b\\>'],
  ['an entity', '&#64;octocat', `\\&\\#${ZWSP}64;octocat`],
  ['a table row', 'a | b', 'a \\| b'],
  ['a list item', '- [x] Signed', '\\- \\[x\\] Signed'],
])('neutraliseText neutralises %s', (_what, raw, expected) => {
  expect(neutraliseText(raw)).toBe(expected);
});

test.each([
  ['a line feed', 'a\nb', 'a b'],
  ['a carriage return', 'a\rb', 'a b'],
  ['CRLF is one break', 'a\r\nb', 'a b'],
  ['two line feeds are two spaces', 'a\n\nb', 'a  b'],
  ['a vertical tab', 'a\u000Bb', 'a b'],
  ['a form feed', 'a\u000Cb', 'a b'],
  ['a next line', 'a\u0085b', 'a b'],
  ['a line separator', 'a\u{2028}b', 'a b'],
  ['a paragraph separator', 'a\u{2029}b', 'a b'],
  ['a break before a fake heading', 'x\n## Passed', `x \\#${ZWSP}\\#${ZWSP} Passed`],
])('neutraliseText turns %s into a space', (_what, raw, expected) => {
  expect(neutraliseText(raw)).toBe(expected);
});

test.each([
  ['a NUL', 'a\u0000b', 'ab'],
  ['a tab', 'a\tb', 'ab'],
  ['DEL and a C1 control', 'a\u007Fb\u009Fc', 'abc'],
  ['the bidi override', `exe.\u202Elive`, 'exe\\.live'],
  ['the bidi isolates', 'a\u2066b\u2069c', 'abc'],
  ['the left-to-right and right-to-left marks', 'a\u{200e}b\u{200f}c', 'abc'],
  ['the Arabic letter mark', 'a\u{61c}b', 'ab'],
  ['the tag block, first, last and one in between', `a${tag(0xe0000)}b${tag(0xe0041)}c${tag(0xe007f)}d`, 'abcd'],
  ['a character just after the tag block', `a${tag(0xe0080)}b`, `a${tag(0xe0080)}b`],
  ['a lone high surrogate', 'a\uD800b', `a${FFFD}b`],
  ['a lone low surrogate', 'a\uDC00b', `a${FFFD}b`],
])('neutraliseText drops or repairs %s', (_what, raw, expected) => {
  expect(neutraliseText(raw)).toBe(expected);
});

test('neutraliseText keeps the ends and the spaces of the text: it is not a name', () => {
  expect(neutraliseText('  a   b  ')).toBe('  a   b  ');
});

test.each([
  ['200 characters stay whole', 'x'.repeat(200), 'x'.repeat(200)],
  ['201 characters are cut to 200, with no mark', 'x'.repeat(201), 'x'.repeat(200)],
  ['200 emoji stay whole', EMOJI.repeat(200), EMOJI.repeat(200)],
  ['201 emoji are cut to 200 whole emoji', EMOJI.repeat(201), EMOJI.repeat(200)],
  ['ten thousand characters', 'y'.repeat(10_000), 'y'.repeat(200)],
  ['escapes do not count: 200 hyphens are 400 characters', '-'.repeat(200), '\\-'.repeat(200)],
  ['and the cut falls between two escapes, never inside one', '-'.repeat(201), '\\-'.repeat(200)],
  ['controls do not count', `${'a\u0000'.repeat(200)}b`, 'a'.repeat(200)],
  ['a CRLF counts as the one space it becomes', 'a\r\n'.repeat(100), 'a '.repeat(100)],
])('neutraliseText cuts to 200 code points: %s', (_what, raw, expected) => {
  expect(neutraliseText(raw)).toBe(expected);
});

test('the zero-width spaces after @ and # do not count toward the 200', () => {
  expect(neutraliseText('@'.repeat(201))).toBe(`@${ZWSP}`.repeat(200));
});
