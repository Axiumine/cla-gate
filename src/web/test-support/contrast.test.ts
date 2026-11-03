// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { hexColour as hex } from './colour-literals.ts';
import { BOUNDARY_MINIMUM, contrastFailures, contrastRatio, relativeLuminance, TEXT_MINIMUM } from './contrast.ts';

// E17-S05: the WCAG 2.2 arithmetic that src/web/theme/contrast.test.ts applies to the tokens. These cases are the
// reference values: if the arithmetic drifted, a palette could pass that a person cannot read.

test('the thresholds are the ones of WCAG 2.2 AA: 4.5 for text, 3 for boundaries and the focus ring', () => {
  expect([TEXT_MINIMUM, BOUNDARY_MINIMUM]).toEqual([4.5, 3]);
});

test.each([
  ['black', hex('000000'), 0],
  ['white', hex('ffffff'), 1],
  ['mid grey', hex('808080'), 0.2158605],
])('the relative luminance of %s (%s) is %f', (_name, colour, expected) => {
  expect(relativeLuminance(colour)).toBeCloseTo(expected, 6);
});

test.each([
  [hex('000000'), hex('ffffff'), 21],
  [hex('ffffff'), hex('000000'), 21],
  [hex('336699'), hex('336699'), 1],
  [hex('767676'), hex('ffffff'), 4.54],
  [hex('777777'), hex('ffffff'), 4.48],
  [hex('949494'), hex('ffffff'), 3.03],
])('the contrast of %s and %s is %f:1, whichever is the foreground', (first, second, expected) => {
  expect(contrastRatio(first, second)).toBeCloseTo(expected, 2);
});

test('the grey that is the last one to pass for text on white passes, and the next one does not', () => {
  expect(contrastRatio(hex('767676'), hex('ffffff'))).toBeGreaterThanOrEqual(TEXT_MINIMUM);
  expect(contrastRatio(hex('777777'), hex('ffffff'))).toBeLessThan(TEXT_MINIMUM);
});

test.each([hex('fff'), 'ffffff', hex('ffffffff'), ['rgb', '(0 0 0)'].join(''), 'white', hex('gggggg'), ''])(
  'a colour that is not spelled #rrggbb (%j) is refused rather than guessed',
  (colour) => {
    expect(() => relativeLuminance(colour)).toThrow('is not a #rrggbb colour');
  },
);

const TOKENS = new Map([
  ['--text', hex('777777')],
  ['--paper', hex('ffffff')],
  ['--rule', hex('949494')],
]);

test('a pair below its minimum is reported with its ratio, and one at or above it is not', () => {
  expect(
    contrastFailures(TOKENS, [
      { foreground: '--text', background: '--paper', minimum: TEXT_MINIMUM },
      { foreground: '--rule', background: '--paper', minimum: BOUNDARY_MINIMUM },
    ]),
  ).toEqual(['--text on --paper: 4.48:1 is below 4.5:1']);
});

test('a pair that names a token without a colour is reported, not skipped', () => {
  expect(
    contrastFailures(TOKENS, [
      { foreground: '--missing', background: '--paper', minimum: TEXT_MINIMUM },
      { foreground: '--text', background: '--gone', minimum: TEXT_MINIMUM },
    ]),
  ).toEqual(['--missing on --paper: a token has no colour', '--text on --gone: a token has no colour']);
});
