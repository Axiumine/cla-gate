// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  COMPANY_NAME_MAX_CODE_POINTS,
  cleanCompanyName,
  cleanRevokeReason,
  cleanSignatoryTitle,
  SIGNATORY_TITLE_MAX_CODE_POINTS,
} from './corporate-text.ts';

// The two free texts of a corporate agreement (E21-S02): one cleaning, two limits. The reason of a revocation (E21-S03) has the same cleaning, a third limit and no `@`.

/** U+202E, the right-to-left override. */
const RLO = String.fromCodePoint(0x202e);

test('the limits are the ones of the columns', () => {
  expect([COMPANY_NAME_MAX_CODE_POINTS, SIGNATORY_TITLE_MAX_CODE_POINTS]).toEqual([200, 100]);
});

test.each([cleanCompanyName, cleanSignatoryTitle])(
  'the text is composed, trimmed and its white space made one space',
  (clean) => {
    expect(clean('  Café   Corp ')).toBe('Café Corp');
  },
);

test.each([cleanCompanyName, cleanSignatoryTitle])('markup, a formula and a mention are kept as typed', (clean) => {
  expect(clean('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>');
  expect(clean('=HYPERLINK("http://evil.example","x")')).toBe('=HYPERLINK("http://evil.example","x")');
  expect(clean('@everyone')).toBe('@everyone');
});

test.each([cleanCompanyName, cleanSignatoryTitle])(
  'nothing, white space only, control characters, overrides and a lone surrogate are refused',
  (clean) => {
    for (const raw of ['', '   ', 'a\tb', 'a\nb', 'a\u0000b', `exe.${RLO}live`, '\u2066x', 'a\u2028b', '\uD800']) {
      expect(clean(raw), JSON.stringify(raw)).toBeNull();
    }
  },
);

test.each([cleanCompanyName, cleanSignatoryTitle])('a text with nothing a person can see in it is refused', (clean) => {
  expect(clean('​​')).toBeNull();
});

test('a company name has 200 code points at most, and a title 100', () => {
  expect(cleanCompanyName('x'.repeat(200))).toBe('x'.repeat(200));
  expect(cleanCompanyName('x'.repeat(201))).toBeNull();
  expect(cleanSignatoryTitle('x'.repeat(100))).toBe('x'.repeat(100));
  expect(cleanSignatoryTitle('x'.repeat(101))).toBeNull();
  expect(cleanCompanyName('\u{1f600}'.repeat(200))).toBe('\u{1f600}'.repeat(200));
  expect(cleanSignatoryTitle('\u{1f600}'.repeat(101))).toBeNull();
});

test('a revocation reason is composed, trimmed and kept as typed otherwise, with 500 code points at most', () => {
  expect(cleanRevokeReason('  Café  left the company ')).toBe('Café left the company');
  expect(cleanRevokeReason('x'.repeat(500))).toBe('x'.repeat(500));
  expect(cleanRevokeReason('x'.repeat(501))).toBeNull();
  expect(cleanRevokeReason('\u{1f600}'.repeat(500))).toBe('\u{1f600}'.repeat(500));
  expect(cleanRevokeReason('\u{1f600}'.repeat(501))).toBeNull();
});

test.each(['', '   ', 'a\tb', 'a\nb', `exe.${RLO}live`, '\uD800'])(
  'a revocation reason of %j is refused, as the other texts are',
  (raw) => {
    expect(cleanRevokeReason(raw)).toBeNull();
  },
);

test.each(['write to ada@example.org', '@everyone', 'a@b', '@'])(
  'a revocation reason with an @ in it (%s) is refused: it is kept for good and an address is personal data',
  (raw) => {
    expect(cleanRevokeReason(raw)).toBeNull();
  },
);
