// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { decodesAsPunycode } from './punycode.ts';

// The decoding of the labels of an internationalised domain name (E21-S03, E21-S04): what decodes to letters, digits and marks, and what does not.

test.each([
  ['a name with one non-ASCII letter among ASCII ones', 'mnchen-3ya'],
  ['the label of the approvals of E21-S03', 'bcher-kva'],
  ['the same in capitals, which punycode digits allow', 'BCHER-KVA'],
  ['a name with no ASCII part (hiragana)', 'r8jz45g'],
  ['a second name with no ASCII part (katakana)', 'zckzah'],
  ['a long name in Han characters, from the specification of RFC 3492', 'ihqwcrb4cv8a8dqg056pqjye'],
  [
    'a long name in kana and Han characters, from the specification of RFC 3492',
    'n8jok5ay5dzabd5bym9f0cm5685rrjetr6pdxa',
  ],
])('%s (%s) decodes to a label', (_label, encoded) => {
  expect(decodesAsPunycode(encoded)).toBe(true);
});

test.each([
  ['no text at all', ''],
  ['the delimiter alone', '-'],
  ['one digit, which decodes to a control character', 'a'],
  ['ASCII with the delimiter after it, which decodes to ASCII only', 'a-'],
  ['a digit that is not one', 'bcher_kva'],
  ['a number cut short', 'bcher-kv'],
  ['a basic part that holds a character outside ASCII', 'ü-kva'],
  ['a number that goes on past what a position can be', '9999999999'],
  ['a code point past the end of Unicode', '9999z'],
  ['a code point that no letter has', '999z'],
])('%s (%s) does not decode to a label', (_label, encoded) => {
  expect(decodesAsPunycode(encoded)).toBe(false);
});
