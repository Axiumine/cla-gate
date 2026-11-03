// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { CLA_TEXT_MAX_BYTES, canonicalise, validateClaText } from './cla-text.ts';
import { indentedBullets, nestedBullets, nestedQuotes } from './test-support.ts';

const at = (...codePoints: number[]): string => String.fromCodePoint(...codePoints);
const BOM = at(0xfeff);
const EURO = at(0x20ac);
const EMOJI = at(0x1f600);

test('the limit is 200 KiB of UTF-8', () => {
  expect(CLA_TEXT_MAX_BYTES).toBe(204_800);
});

test.each([
  ['a text that is already canonical', 'Line one\nLine two\n', 'Line one\nLine two\n'],
  ['a text with no final line feed', 'Line one', 'Line one\n'],
  ['nothing', '', '\n'],
  ['a single line feed', '\n', '\n'],
  ['only line feeds', '\n\n\n\n', '\n'],
  ['only carriage returns', '\r\r\r', '\n'],
  ['CRLF line endings', 'a\r\nb\r\nc\r\n', 'a\nb\nc\n'],
  ['lone CR line endings', 'a\rb\rc', 'a\nb\nc\n'],
  ['all three line endings in one text', 'a\r\nb\rc\nd', 'a\nb\nc\nd\n'],
  ['two CRs and an LF, which are two line endings', 'a\r\r\nb', 'a\n\nb\n'],
  ['a leading byte order mark', `${BOM}a\n`, 'a\n'],
  ['a byte order mark and nothing else', BOM, '\n'],
  ['a byte order mark before CRLF', `${BOM}\r\na`, '\na\n'],
  ['a run of byte order marks, which a second call would otherwise remove one by one', `${BOM}${BOM}${BOM}a`, 'a\n'],
  ['a byte order mark inside the text', `a${BOM}b`, `a${BOM}b\n`],
  ['a byte order mark after a line feed', `\n${BOM}a`, `\n${BOM}a\n`],
  ['several final line feeds', 'a\n\n\n', 'a\n'],
  ['several final CRLFs', 'a\r\n\r\n\r\n', 'a\n'],
  ['final line endings of all three kinds', 'a\r\n\r\n\r', 'a\n'],
  ['blank lines inside the text', 'a\n\n\nb\n', 'a\n\n\nb\n'],
  ['blank lines at the start', '\n\na\n', '\n\na\n'],
  ['two spaces at the end of a line, a Markdown line break', 'a  \nb  \r\nc', 'a  \nb  \nc\n'],
  ['two spaces at the end of the text', 'a  ', 'a  \n'],
  ['a final line of spaces', 'a\n  \n', 'a\n  \n'],
  ['tabs and indentation', '\ta\n    b', '\ta\n    b\n'],
  ['a decomposed letter, which is not normalised', `e${at(0x301)}\n`, `e${at(0x301)}\n`],
  ['a composed letter, which is not normalised either', `${at(0xe9)}\n`, `${at(0xe9)}\n`],
  ['a lone surrogate, which validation and not canonicalisation refuses', `a${at(0xd800)}`, `a${at(0xd800)}\n`],
])('canonicalise: %s', (_label, input, expected) => {
  expect(canonicalise(input)).toBe(expected);
  expect(canonicalise(expected)).toBe(expected);
});

test('canonicalise reads a text of hundreds of thousands of line feeds in one pass, at either end', () => {
  const lines = 400_000;
  expect(canonicalise(`${'\n'.repeat(lines)}a`)).toBe(`${'\n'.repeat(lines)}a\n`);
  expect(canonicalise(`a${'\n'.repeat(lines)}`)).toBe('a\n');
  expect(canonicalise('\r\n'.repeat(lines))).toBe('\n');
  expect(canonicalise(BOM.repeat(lines))).toBe('\n');
});

test.each([
  ['a text of one line', 'I agree.\n'],
  ['a text with a tab and blank lines', '# Title\n\n\tindented\n'],
  ['a text with emoji, CJK and a combining mark', `${EMOJI} ${at(0x4e2d, 0x6587)} e${at(0x301)}\n`],
  ['DEL, which is not a C0 control character', `a${at(0x7f)}b\n`],
  ['a C1 control character, which is not a C0 one', `a${at(0x85)}b\n`],
  ['a byte order mark inside the text', `a${BOM}b\n`],
  ['a text with a valid surrogate pair', `${at(0xd83d, 0xde00)}\n`],
])('validateClaText accepts %s', (_label, text) => {
  expect(validateClaText(text)).toBeNull();
});

const edge = (prefix: number, last: string): string => `${'a'.repeat(prefix)}${last}`;

test.each([
  ['exactly 204 800 bytes of one-byte characters', edge(204_799, '\n'), null],
  ['204 801 bytes of one-byte characters', edge(204_800, '\n'), 204_801],
  ['a two-byte character that ends at the limit', edge(204_798, at(0xe9)), null],
  ['a two-byte character that starts at the limit', edge(204_799, at(0xe9)), 204_801],
  ['a three-byte character that ends at the limit', edge(204_797, EURO), null],
  ['a three-byte character that straddles the limit', edge(204_799, EURO), 204_802],
  ['a four-byte character that ends at the limit', edge(204_796, EMOJI), null],
  ['a four-byte character that straddles the limit', edge(204_797, EMOJI), 204_801],
  ['fewer characters than the limit but more bytes', EURO.repeat(68_267), 204_801],
  ['fewer UTF-16 units than the limit but more bytes', EMOJI.repeat(51_201), 204_804],
  ['as many bytes as the limit of three-byte characters and a rest', `${EURO.repeat(68_266)}aa`, null],
])('validateClaText counts UTF-8 bytes, not characters: %s', (_label, text, tooLarge) => {
  expect(validateClaText(text)).toEqual(
    tooLarge === null ? null : { rule: 'content_too_large', details: { limitBytes: 204_800, actualBytes: tooLarge } },
  );
});

test('a text that is too large is refused for its size before any other rule, and the problem holds no part of the text', () => {
  expect(validateClaText('\u0000'.repeat(204_801))).toStrictEqual({
    rule: 'content_too_large',
    details: { limitBytes: 204_800, actualBytes: 204_801 },
  });
});

test.each([
  ['nothing', ''],
  ['a line feed', '\n'],
  ['spaces, tabs and line feeds', ' \t \n\n  \t\n'],
  ['no-break and em spaces', `${at(0xa0, 0x2003)}\n`],
  ['an ideographic space and a line separator', `${at(0x3000, 0x2028)}\n`],
  ['a byte order mark that is not at the start of the text', `\n${BOM}\n`],
  ['a vertical tab and a form feed', '\u000b\u000c'],
])('validateClaText: %s has no character that is not white space', (_label, text) => {
  expect(validateClaText(text)).toEqual({ rule: 'content_empty' });
});

test.each([
  ['NUL', 'a\u0000b\n'],
  ['NUL alone', '\u0000'],
  ['start of heading', 'a\u0001b\n'],
  ['backspace', 'a\u0008b\n'],
  ['vertical tab inside a text', 'a\u000bb\n'],
  ['form feed inside a text', 'a\u000cb\n'],
  ['a carriage return, which a canonical text no longer has', 'a\rb\n'],
  ['escape', 'a\u001bb\n'],
  ['unit separator', 'a\u001fb\n'],
  ['a lone high surrogate', `a${at(0xd800)}b\n`],
  ['a lone low surrogate', `a${at(0xdc00)}b\n`],
  ['a high surrogate at the end', `ab${at(0xd83d)}\n`],
  ['a low surrogate before a high one', `${at(0xde00, 0xd83d)}\n`],
  ['white space with a lone surrogate, which is a character', `  ${at(0xd800)}\n`],
  ['white space with a NUL, which is a character', ' \u0000 \n'],
])('validateClaText: %s is content_invalid_characters', (_label, text) => {
  expect(validateClaText(text)).toEqual({ rule: 'content_invalid_characters' });
});

test('the problems say what is wrong and never repeat the text', () => {
  const marker = 'MARKER-OF-A-HOSTILE-TEXT';
  const problems = [
    validateClaText(`${marker}\u0000\n`),
    validateClaText(`${marker}${'a'.repeat(CLA_TEXT_MAX_BYTES)}\n`),
    validateClaText(`${marker}${at(0xd800)}\n`),
  ];
  expect(problems.map((problem) => problem?.rule)).toEqual([
    'content_invalid_characters',
    'content_too_large',
    'content_invalid_characters',
  ]);
  expect(JSON.stringify(problems)).not.toContain(marker);
});

test.each([
  ['block quotes', nestedQuotes],
  ['bullets opened on one line', nestedBullets],
  ['lists nested by indentation', indentedBullets],
])(
  'validateClaText accepts 50 levels of %s and refuses 51 as content_too_deeply_nested (E12-S07)',
  (_label, nested) => {
    expect(validateClaText(nested(50))).toBeNull();
    expect(validateClaText(nested(51))).toEqual({ rule: 'content_too_deeply_nested' });
  },
);

test('a text nested far above the limit is refused as content_too_deeply_nested, and the problem holds nothing of it', () => {
  const problem = validateClaText(`${'> '.repeat(100_000)}MARKER-OF-A-DEEP-TEXT\n`);
  expect(problem).toEqual({ rule: 'content_too_deeply_nested' });
  expect(JSON.stringify(problem)).not.toContain('MARKER');
});

test.each([
  ['a 100 KiB run of [', '['.repeat(102_400)],
  ['a 100 KiB run of *', '*'.repeat(102_400)],
  ['a 100 KiB run of unmatched emphasis openers', '*a '.repeat(34_000)],
])('validateClaText accepts %s: it is not deep, and reading it overflows no stack', (_label, text) => {
  expect(validateClaText(`${text}\n`)).toBeNull();
});

test.each([
  ['too large before too deep', `${'> '.repeat(51)}${'a'.repeat(CLA_TEXT_MAX_BYTES)}\n`, 'content_too_large'],
  ['empty is not deep', '\n', 'content_empty'],
  ['invalid characters before too deep', `${'> '.repeat(51)}a\u0000\n`, 'content_invalid_characters'],
])('validateClaText checks the depth after the rules of the characters: %s', (_label, text, rule) => {
  expect(validateClaText(text)).toMatchObject({ rule });
});
