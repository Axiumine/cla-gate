// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { findColourLiterals, hexColour } from './colour-literals.ts';

// E17-S05: what counts as a colour literal. The examples are assembled from parts, so that this file holds none itself.

const HASH = '#';
const hex = hexColour;
const call = (name: string): string => `${name}(`;

test.each([
  ['three digits', hex('fff')],
  ['four digits', hex('fff8')],
  ['six digits', hex('0969DA')],
  ['eight digits', hex('0969da80')],
])('a hex colour of %s is found', (_name, literal) => {
  expect(findColourLiterals(`a { color: ${literal}; }`)).toEqual([literal]);
  expect(findColourLiterals(`const c = '${literal}';`)).toEqual([literal]);
});

test.each(['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color'])(
  'the colour function %s is found',
  (name) => {
    expect(findColourLiterals(`a { color: ${call(name)}0 0 0); }`)).toEqual([call(name)]);
  },
);

test('every literal is returned in the order it appears, whatever its kind', () => {
  expect(findColourLiterals(`${hex('abc')} ${call('rgb')}1 2 3) ${hex('123456')} ${call('hsl')}0 0% 0%)`)).toEqual([
    hex('abc'),
    call('rgb'),
    hex('123456'),
    call('hsl'),
  ]);
});

test.each([
  ['a character reference', '&#x27; and &#39; and &#xAbc;'],
  ['a name that continues', `${hex('abcdef')}-x ${hex('abcdefg')} ${hex('main')}`],
  ['a number sign after a word', `see item${hex('123')}`],
  ['a custom property reference', 'color: var(--fg); background: var(--color-surface)'],
  [
    'a function whose name only ends like a colour one',
    `surface${call('color')}1) --my-${call('rgb')}2) lower${call('color')}3)`,
  ],
  ['five, seven or nine digits', `${hex('12345')} ${hex('1234567')} ${hex('123456789')}`],
  ['a hash that starts a comment or a private field', `${HASH}private ${HASH}!shebang`],
])('%s is not a colour', (_name, text) => {
  expect(findColourLiterals(text)).toEqual([]);
});
