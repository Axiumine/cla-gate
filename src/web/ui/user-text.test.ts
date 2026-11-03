// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { clipText, visibleText } from './user-text.ts';

// E17-S11: the two steps UserText takes before text reaches the screen. The characters are named by code point, never typed:
// a control or bidirectional character written into this file would be invisible, and some would act on the file itself.

const ELLIPSIS = String.fromCodePoint(0x2026);
const RLO = String.fromCodePoint(0x202e);
const ZWJ = String.fromCodePoint(0x200d);
const EMOJI = String.fromCodePoint(0x1f600);
const FAMILY = [0x1f469, 0x1f469, 0x1f467, 0x1f466].map((code) => String.fromCodePoint(code)).join(ZWJ);

test.each([
  ['NUL, the first C0 control', 0x0000, '<U+0000>'],
  ['tab', 0x0009, '<U+0009>'],
  ['the vertical tab, just after the newline', 0x000b, '<U+000B>'],
  ['carriage return', 0x000d, '<U+000D>'],
  ['the last C0 control', 0x001f, '<U+001F>'],
  ['delete', 0x007f, '<U+007F>'],
  ['the first C1 control', 0x0080, '<U+0080>'],
  ['the last C1 control', 0x009f, '<U+009F>'],
  ['left-to-right mark', 0x200e, '<U+200E>'],
  ['right-to-left mark', 0x200f, '<U+200F>'],
  ['the first embedding', 0x202a, '<U+202A>'],
  ['right-to-left embedding', 0x202b, '<U+202B>'],
  ['pop directional formatting', 0x202c, '<U+202C>'],
  ['left-to-right override', 0x202d, '<U+202D>'],
  ['right-to-left override, the last of the range', 0x202e, '<U+202E>'],
  ['the first isolate', 0x2066, '<U+2066>'],
  ['right-to-left isolate', 0x2067, '<U+2067>'],
  ['first strong isolate', 0x2068, '<U+2068>'],
  ['pop directional isolate, the last of the range', 0x2069, '<U+2069>'],
  ['the byte order mark', 0xfeff, '<U+FEFF>'],
  ['the first high surrogate, alone', 0xd800, '<U+D800>'],
  ['the last high surrogate, alone', 0xdbff, '<U+DBFF>'],
  ['the first low surrogate, alone', 0xdc00, '<U+DC00>'],
  ['the last low surrogate, alone', 0xdfff, '<U+DFFF>'],
])('%s (code point %i) is shown as %s', (_what, code, placeholder) => {
  expect(visibleText(String.fromCodePoint(code))).toBe(placeholder);
});

test.each([
  ['the newline, which is the one control that stays', 0x000a],
  ['the space, just after the C0 controls', 0x0020],
  ['the tilde, just before delete', 0x007e],
  ['the no-break space, just after the C1 controls', 0x00a0],
  ['the zero width space', 0x200b],
  ['the zero width non-joiner', 0x200c],
  ['the zero width joiner, which emoji sequences need', 0x200d],
  ['the hyphen, just after the marks', 0x2010],
  ['the line separator and the paragraph separator, just before the embeddings', 0x2028],
  ['the paragraph separator', 0x2029],
  ['the narrow no-break space, just after the embeddings', 0x202f],
  ['the unassigned code point just before the isolates', 0x2065],
  ['the first deprecated format character, just after the isolates', 0x206a],
  ['the unassigned code point just before the byte order mark', 0xfefe],
  ['the fullwidth exclamation mark, just after the byte order mark', 0xff01],
  ['the last code point before the surrogates', 0xd7ff],
  ['the first private use code point, just after the surrogates', 0xe000],
  ['a 4-byte emoji', 0x1f600],
  ['the last code point there is', 0x10ffff],
])('%s (code point %i) is shown as it is', (_what, code) => {
  const character = String.fromCodePoint(code);
  expect(visibleText(character)).toBe(character);
});

test('a family emoji, which is four 4-byte emoji joined, and an emoji next to a text, stay whole', () => {
  expect(visibleText(FAMILY)).toBe(FAMILY);
  expect(visibleText(`a${EMOJI}b`)).toBe(`a${EMOJI}b`);
});

test('a surrogate pair is one character and stays; a lone one next to a pair, or next to a lone one, is shown', () => {
  const highAlone = String.fromCharCode(0xd83d);
  const lowAlone = String.fromCharCode(0xde00);
  expect(visibleText(`${highAlone}${EMOJI}`)).toBe(`<U+D83D>${EMOJI}`);
  expect(visibleText(`${EMOJI}${lowAlone}`)).toBe(`${EMOJI}<U+DE00>`);
  expect(visibleText(`${lowAlone}${highAlone}`)).toBe('<U+DE00><U+D83D>');
  expect(visibleText(`${highAlone}a`)).toBe('<U+D83D>a');
});

test('the text around a hidden character is kept in order, each one is written out, and a repeat is written out each time', () => {
  expect(visibleText(`exe.${RLO}live`)).toBe('exe.<U+202E>live');
  expect(visibleText(`${RLO}${RLO}`)).toBe('<U+202E><U+202E>');
  expect(visibleText('line 1\nline 2')).toBe('line 1\nline 2');
  expect(visibleText('a\r\nb')).toBe('a<U+000D>\nb');
});

test('a placeholder that a person typed is just text: nothing is written out twice, and nothing marks it as typed', () => {
  expect(visibleText('<U+202E>')).toBe('<U+202E>');
  expect(visibleText('plain text, markup <b>and</b> all')).toBe('plain text, markup <b>and</b> all');
});

test('a text no longer than maxLength is not cut, whatever its length in UTF-16 units', () => {
  expect(clipText('abc', 3)).toBeNull();
  expect(clipText('', 1)).toBeNull();
  expect(clipText(`${EMOJI}${EMOJI}${EMOJI}`, 3)).toBeNull();
  expect(clipText(FAMILY, 1)).toBeNull();
});

test('a longer text is cut after maxLength characters and ends in an ellipsis', () => {
  expect(clipText('abcdef', 3)).toBe(`abc${ELLIPSIS}`);
  expect(clipText('abcdef', 5)).toBe(`abcde${ELLIPSIS}`);
  expect(clipText('abc', 1)).toBe(`a${ELLIPSIS}`);
  expect(clipText('x'.repeat(10_000), 20)).toBe(`${'x'.repeat(20)}${ELLIPSIS}`);
});

test('the cut falls between characters as a person counts them: an emoji, a family and a letter with its accent stay whole', () => {
  const accented = `e${String.fromCodePoint(0x0301)}`;
  expect(clipText(`${EMOJI}${EMOJI}${EMOJI}`, 2)).toBe(`${EMOJI}${EMOJI}${ELLIPSIS}`);
  expect(clipText(`${FAMILY}abc`, 1)).toBe(`${FAMILY}${ELLIPSIS}`);
  expect(clipText(`${FAMILY}abc`, 2)).toBe(`${FAMILY}a${ELLIPSIS}`);
  expect(clipText(`${accented}xyz`, 1)).toBe(`${accented}${ELLIPSIS}`);
});

test('a hidden character counts as one, and the part that is kept is written out without its placeholder cut', () => {
  expect(clipText(`ab${RLO}cd`, 3)).toBe(`ab<U+202E>${ELLIPSIS}`);
  expect(clipText(`ab${RLO}cd`, 2)).toBe(`ab${ELLIPSIS}`);
  expect(clipText('\r\nabc', 1)).toBe(`<U+000D>\n${ELLIPSIS}`);
  expect(clipText(`${String.fromCharCode(0xd800)}ab`, 1)).toBe(`<U+D800>${ELLIPSIS}`);
});

test.each([
  ['zero', 0],
  ['a negative number', -1],
  ['a fraction', 1.5],
  ['not a number', Number.NaN],
  ['infinity', Number.POSITIVE_INFINITY],
])('%s as maxLength is a programming error, and says so', (_what, maxLength) => {
  expect(() => clipText('abc', maxLength)).toThrow(RangeError);
  expect(() => clipText('abc', maxLength)).toThrow(/maxLength must be a whole number of at least 1/u);
});
