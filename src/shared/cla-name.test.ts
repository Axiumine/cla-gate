// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { DOCUMENT_NAME_MAX_CODE_POINTS, normaliseDocumentName } from './cla-name.ts';

const at = (...codePoints: number[]): string => String.fromCodePoint(...codePoints);

test('the limit is 100 code points', () => {
  expect(DOCUMENT_NAME_MAX_CODE_POINTS).toBe(100);
});

test.each([
  ['a plain name', 'Individual CLA', 'Individual CLA'],
  ['spaces at both ends', '   Individual CLA  ', 'Individual CLA'],
  ['a run of spaces inside', 'Individual    CLA', 'Individual CLA'],
  ['a no-break space and an em space', `A${at(0xa0)}${at(0x2003)}B`, 'A B'],
  ['a no-break space at the end', `A${at(0xa0)}`, 'A'],
  ['a decomposed e with an acute accent', `Caf${at(0x65, 0x301)}`, `Caf${at(0xe9)}`],
  ['a name already in NFC', `Caf${at(0xe9)}`, `Caf${at(0xe9)}`],
  ['one code point', 'x', 'x'],
  ['100 code points', 'x'.repeat(100), 'x'.repeat(100)],
  ['100 code points of two UTF-16 units each', at(0x1f600).repeat(100), at(0x1f600).repeat(100)],
  ['an emoji ZWJ sequence', `${at(0x1f469)}${at(0x200d)}${at(0x1f4bb)}`, `${at(0x1f469)}${at(0x200d)}${at(0x1f4bb)}`],
  ['a zero width joiner and non-joiner', `a${at(0x200d)}b${at(0x200c)}c`, `a${at(0x200d)}b${at(0x200c)}c`],
  [
    'right-to-left text without overrides',
    `${at(0x5e9, 0x5dc, 0x5d5, 0x5dd)} ${at(0x645, 0x631, 0x62d, 0x628, 0x627)}`,
    `${at(0x5e9, 0x5dc, 0x5d5, 0x5dd)} ${at(0x645, 0x631, 0x62d, 0x628, 0x627)}`,
  ],
  ['markup', '<script>alert(1)</script>', '<script>alert(1)</script>'],
  ['a spreadsheet formula', '=HYPERLINK("http://evil.example","x")', '=HYPERLINK("http://evil.example","x")'],
  ['a mention', '@everyone', '@everyone'],
  ['a quote and a semicolon', "'; drop table users;--", "'; drop table users;--"],
])('%s is a name: %j', (_label, raw, kept) => {
  expect(normaliseDocumentName(raw)).toBe(kept);
});

test.each([
  ['nothing', ''],
  ['spaces only', '    '],
  ['no-break spaces only', at(0xa0, 0xa0)],
  ['a line feed', 'a\nb'],
  ['a line feed at the end', 'name\n'],
  ['a carriage return', 'a\rb'],
  ['a tab', 'a\tb'],
  ['a NUL', 'a\u0000b'],
  ['a C0 control', `a${at(0x1b)}b`],
  ['DEL', `a${at(0x7f)}b`],
  ['a C1 control', `a${at(0x85)}b`],
  ['a line separator', `a${at(0x2028)}b`],
  ['a paragraph separator', `a${at(0x2029)}b`],
  ['a left-to-right embedding', `a${at(0x202a)}b`],
  ['a right-to-left override', `evil${at(0x202e)}gnp.exe`],
  ['the end of a bidi override', `a${at(0x202c)}b`],
  ['a left-to-right isolate', `a${at(0x2066)}b`],
  ['a pop directional isolate', `a${at(0x2069)}b`],
  ['a lone high surrogate', 'a\ud800b'],
  ['a lone low surrogate', 'a\udc00b'],
  ['a lone surrogate alone', '\ud800'],
  ['101 code points', 'x'.repeat(101)],
  ['101 code points of two UTF-16 units each', at(0x1f600).repeat(101)],
  ['a very long name', 'x'.repeat(1_000_000)],
])('%s is not a name', (_label, raw) => {
  expect(normaliseDocumentName(raw)).toBeNull();
});

test('a name over 100 code points only because of whitespace is a name once the whitespace is collapsed', () => {
  expect(normaliseDocumentName(`${'x'.repeat(50)}${' '.repeat(80)}${'y'.repeat(49)}`)).toBe(
    `${'x'.repeat(50)} ${'y'.repeat(49)}`,
  );
});

test('a name of 101 code points after collapsing is refused, 100 is accepted', () => {
  expect(normaliseDocumentName(`${'x'.repeat(50)} ${'y'.repeat(49)}`)).not.toBeNull();
  expect(normaliseDocumentName(`${'x'.repeat(50)} ${'y'.repeat(50)}`)).toBeNull();
});

test('cleaning is idempotent: a stored name cleans to itself', () => {
  const samples = ['  a   b ', `Caf${at(0x65, 0x301)}`, at(0x1f600).repeat(100), 'A  B  C'];
  for (const sample of samples) {
    const once = normaliseDocumentName(sample);
    expect(once).not.toBeNull();
    expect(normaliseDocumentName(once ?? '')).toBe(once);
  }
});
