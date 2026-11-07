// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { decodePunycode, decodesAsPunycode } from './punycode.ts';

// The decoder of punycode (E21-S03, E21-S04) against RFC 3492, so that no constant or comparison of it can change unseen. The decoder
// answers yes or no, so a wrong constant (the bias, the skew, the damp, the first code point) would show only as a different letter, and a
// different letter is a letter all the same. Two things hold it: the sample strings of section 7.1 of the RFC with their encodings as
// written there, and an encoder written from section 6.3 that makes a label out of code points chosen at the edges of what an
// internationalised label may be made of, so that a decoding one step off lands on the other side of the edge. The decoder is also asked for
// the code points themselves, which is the only way to hold constants (the skew, the damp, the first bias) whose error moves a code point to
// another letter: a yes or a no cannot tell.

const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;

/** The bias after a step: section 6.1 of the RFC. */
function adaptBias(delta: number, points: number, first: boolean): number {
  let rest = Math.floor(delta / (first ? 700 : 2));
  rest += Math.floor(rest / points);
  let steps = 0;
  while (rest > ((BASE - T_MIN) * T_MAX) / 2) {
    rest = Math.floor(rest / (BASE - T_MIN));
    steps += BASE;
  }
  return steps + Math.floor(((BASE - T_MIN + 1) * rest) / (rest + 38));
}

/** The digit that stands for `value`: `a` to `z` are 0 to 25 and `0` to `9` are 26 to 35. */
const digitOf = (value: number): string => String.fromCharCode(value < 26 ? value + 97 : value + 22);

/** The variable-length number for `delta` at `bias` (section 6.3 of the RFC), as digits. */
function numberOf(delta: number, bias: number): string {
  let out = '';
  let rest = delta;
  for (let k = BASE; ; k += BASE) {
    const threshold = Math.min(Math.max(k - bias, T_MIN), T_MAX);
    if (rest < threshold) {
      return out + digitOf(rest);
    }
    out += digitOf(threshold + ((rest - threshold) % (BASE - threshold)));
    rest = Math.floor((rest - threshold) / (BASE - threshold));
  }
}

/** Where the encoder is: the next code point to place, the distance so far, the bias, how many code points are placed, and the text. */
interface Encoding {
  n: number;
  delta: number;
  bias: number;
  handled: number;
  out: string;
}

/** One code point of the input against the code point `state.n` that is being placed: it is counted when below it, and written when it is it. */
function place(state: Encoding, point: number, basicCount: number): void {
  if (point < state.n) {
    state.delta += 1;
  }
  if (point === state.n) {
    state.out += numberOf(state.delta, state.bias);
    state.bias = adaptBias(state.delta, state.handled + 1, state.handled === basicCount);
    state.delta = 0;
    state.handled += 1;
  }
}

/** The encoding of `input` (code points) by section 6.3 of the RFC, without the `xn--` that goes before it. */
function encode(input: readonly number[]): string {
  const basic = input.filter((point) => point < 128);
  const state: Encoding = {
    n: 128,
    delta: 0,
    bias: 72,
    handled: basic.length,
    out: String.fromCharCode(...basic) + (basic.length > 0 ? '-' : ''),
  };
  while (state.handled < input.length) {
    const next = Math.min(...input.filter((point) => point >= state.n));
    state.delta += (next - state.n) * (state.handled + 1);
    state.n = next;
    for (const point of input) {
      place(state, point, basic.length);
    }
    state.delta += 1;
    state.n += 1;
  }
  return state.out;
}

/** The code points of a text. */
const pointsOf = (text: string): number[] => Array.from(text, (char) => char.codePointAt(0) ?? 0);

test.each([
  ['Chinese (simplified)', '他们为什么不说中文', 'ihqwcrb4cv8a8dqg056pqjye'],
  ['Chinese (traditional)', '他們爲什麽不說中文', 'ihqwctvzc91f659drss3x8bo0yb'],
  ['Czech', 'Pročprostěnemluvíčesky', 'Proprostnemluvesky-uyb24dma41a'],
  ['Hebrew', 'למההםפשוטלאמדבריםעברית', '4dbcagdahymbxekheh6e0a7fei0b'],
  ['Hindi (Devanagari)', 'यहलोगहिन्दीक्योंनहींबोलसकतेहैं', 'i1baa7eci9glrd9b2ae1bj0hfcgg6iyaf8o0a1dig0cd'],
  ['Japanese (kanji and hiragana)', 'なぜみんな日本語を話してくれないのか', 'n8jok5ay5dzabd5bym9f0cm5685rrjetr6pdxa'],
  [
    'Korean (Hangul syllables)',
    '세계의모든사람들이한국어를이해한다면얼마나좋을까',
    '989aomsvi5e83db1d2a355cv1e0vak1dwrv93d5xbh15a0dt30a5jpsd879ccm6fea98c',
  ],
  ['Russian (Cyrillic)', 'почемужеонинеговорятпорусски', 'b1abfaaepdrnnbgefbadotcwatmq2g4l'],
  ['Spanish', 'PorquénopuedensimplementehablarenEspañol', 'PorqunopuedensimplementehablarenEspaol-fmd56a'],
  ['Vietnamese', 'TạisaohọkhôngthểchỉnóitiếngViệt', 'TisaohkhngthchnitingVit-kjcr8268qyxafd2f1b9g'],
  ['3年B組金八先生', '3年B組金八先生', '3B-ww4c5e180e575a65lsy2b'],
  ['安室奈美恵-with-SUPER-MONKEYS', '安室奈美恵-with-SUPER-MONKEYS', '-with-SUPER-MONKEYS-pc58ag80a8qai00g7n9n'],
  ['Hello-Another-Way-それぞれの場所', 'Hello-Another-Way-それぞれの場所', 'Hello-Another-Way--fc4qua05auwb3674vfr0b'],
  ['ひとつ屋根の下2', 'ひとつ屋根の下2', '2-u9tlzr9756bt3uc0v'],
  ['MajiでKoiする5秒前', 'MajiでKoiする5秒前', 'MajiKoi5-783gue6qz075azm5e'],
  ['パフィーdeルンバ', 'パフィーdeルンバ', 'de-jg4avhby1noc0d'],
  ['そのスピードで', 'そのスピードで', 'd9juau41awczczp'],
])(
  'the sample string %s of the RFC, %s, is written %s, and the decoder takes that for a label',
  (_name, text, written) => {
    expect(encode(pointsOf(text))).toBe(written);
    expect(decodePunycode(written)).toEqual(pointsOf(text));
    expect(decodesAsPunycode(written)).toBe(true);
  },
);

test.each([
  ['Arabic (Egyptian), which holds a question mark', 'ليهمابتكلموشعربي؟', 'egbpdaj6bu4bxfgehfvwxn'],
  ['ASCII only', '-> $1.00 <-', '-> $1.00 <--'],
])(
  'the sample string %s of the RFC is written %s, and the decoder does not take it for a label',
  (_name, text, written) => {
    expect(encode(pointsOf(text))).toBe(written);
    expect(decodePunycode(written)).toEqual(pointsOf(text));
    expect(decodesAsPunycode(written)).toBe(false);
  },
);

test.each([
  ['a feminine ordinal indicator, the first letter after the sign of the copyright', [0xaa]],
  ['a superscript one, a number', [0xb9]],
  ['a masculine ordinal indicator', [0xba]],
  ['a micro sign, a letter between two signs', [0xb5]],
  ['a combining grave accent, the first mark', [0x61, 0x300]],
  ['a combining small letter x, the last mark of its block', [0x61, 0x36f]],
  ['a Greek capital letter heta, the letter after the marks', [0x370]],
  ['a letter of the last plane that has some', [0x61, 0x3134a]],
  ['a compatibility ideograph in the second plane', [0x2fa1d]],
  ['a variation selector, a mark far into the range', [0x61, 0xe0100]],
  ['a long name with a letter far out', [...pointsOf('a'.repeat(58)), 0x2fa1d]],
  ['a long name of many letters outside ASCII', pointsOf('ä'.repeat(60))],
])('%s is a label that the decoder takes', (_name, points) => {
  expect(decodePunycode(encode(points))).toEqual(points);
  expect(decodesAsPunycode(encode(points))).toBe(true);
});

test.each([
  ['a copyright sign, a symbol', [0xa9]],
  ['a left-pointing double angle quotation mark, after the ordinal indicators', [0xab]],
  ['a pilcrow, a punctuation mark between letters', [0xb6]],
  ['a right-pointing double angle quotation mark', [0xbb]],
  ['a multiplication sign', [0xd7]],
  ['a division sign', [0xf7]],
  ['a non-breaking space', [0xa0]],
  ['a control character after a letter', [0x61, 0x80]],
  ['a name with a question mark in it', pointsOf('ä?')],
  ['a Unicode noncharacter at the end of the last plane', [0x10ffff]],
  ['a private use character at the end of the last plane', [0x10fffd]],
  ['a code point past the end of Unicode', [0x110000]],
  ['a code point far past the end of Unicode', [0x61, 0x110000 * 64]],
  ['a name with one sign after many letters', [...pointsOf('ä'.repeat(40)), 0xd7]],
])('%s is not a label that the decoder takes', (_name, points) => {
  expect(decodesAsPunycode(encode(points))).toBe(false);
});

test.each([
  ['the last code point of Unicode, a noncharacter', [0x10ffff]],
  ['the last code point of Unicode after a letter', [0x61, 0x10ffff]],
  [
    'many letters, then one of the compatibility ideographs whose step ends the bias exactly on its limit, then another',
    [0x61, 0x62, 0x63, 0xf99c, 0x4e2d],
  ],
  ['the same with the second one far from the first', [0x61, 0x62, 0x63, 0xf99c, 0x1f600]],
  ['two code points whose first step lies where a damp of 699 gives another bias than 700', [6419, 0x4e00]],
  ['two code points whose first step lies where a damp of 701 gives another bias than 700', [6428, 0x4e00]],
])('the decoder gives back the code points of %s', (_name, points) => {
  expect(decodePunycode(encode(points))).toEqual(points);
});

test.each([
  ['a code point past the end of Unicode', [0x110000]],
  ['a code point far past the end', [0x61, 0x110000 * 64]],
])('the decoder refuses %s', (_name, points) => {
  expect(decodePunycode(encode(points))).toBeNull();
});

test('a character outside ASCII before the last hyphen is no basic code point, and the last one inside it is', () => {
  expect(decodePunycode('a\u0080-a')).toBeNull();
  expect(decodePunycode('a\u007f-a')).toEqual([0x80, 0x61, 0x7f]);
});

test('a hyphen at the very start is not a delimiter: the text is read from its first character, where the hyphen is no digit', () => {
  const body = encode([0xfc]);
  expect(body).toBe('tda');
  expect(decodePunycode(body)).toEqual([0xfc]);
  expect(decodePunycode(`-${body}`)).toBeNull();
  expect(decodesAsPunycode(`-${body}`)).toBe(false);
  expect(decodePunycode('-')).toBeNull();
  expect(decodesAsPunycode(encode([0x2d, 0xfc]))).toBe(true);
});

/** The digits of the encoded part of a text: what follows the last hyphen, or all of it when there is none. */
const digitsOf = (encoded: string): string => encoded.slice(encoded.lastIndexOf('-') + 1);

test('every digit, in lower case and in capitals, is read as a digit: names whose encodings use all thirty-six of them are taken', () => {
  const seen = new Set<string>();
  const letters = [
    ...Array.from({ length: 0x150 }, (_unused, offset) => 0x100 + offset),
    ...Array.from({ length: 400 }, (_unused, offset) => 0x4e00 + offset * 7),
  ];
  for (const point of letters) {
    const encoded = encode([0x61, point]);
    for (const digit of digitsOf(encoded)) {
      seen.add(digit);
    }
    expect(decodesAsPunycode(encoded), encoded).toBe(true);
    expect(decodesAsPunycode(encoded.toUpperCase()), encoded).toBe(true);
  }
  expect([...seen].toSorted((a, b) => a.localeCompare(b)).join('')).toBe('0123456789abcdefghijklmnopqrstuvwxyz');
});

test.each([
  ['the character before the digits', '/'],
  ['the character after the digits', ':'],
  ['the character before the capitals', '@'],
  ['the character after the capitals', '['],
  ['the character before the lower case letters', '`'],
  ['the character after the lower case letters', '{'],
])('%s, in place of the last digit of a number, is no digit and the label is none', (_name, instead) => {
  expect(decodesAsPunycode('bcher-kva')).toBe(true);
  expect(decodesAsPunycode(`bcher-kv${instead}`)).toBe(false);
});

test('a number of hundreds of digits is no label, and it does not make the decoder fail', () => {
  expect(decodesAsPunycode(`${'9'.repeat(400)}a`)).toBe(false);
  expect(decodesAsPunycode(`bcher-${'9'.repeat(400)}a`)).toBe(false);
});

test('only the last hyphen ends the part that stands for itself: the hyphens before it are letters of the name', () => {
  expect(decodesAsPunycode('a-b-c-')).toBe(false);
  expect(decodesAsPunycode(encode(pointsOf('a-ü-b')))).toBe(true);
});
