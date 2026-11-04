// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { SIGNER_EMAIL_MAX_LENGTH } from '../../shared/signer-input.ts';
import { resolveSignerEmail } from './signer-email.ts';

// E13-S03: which verified address a signer asked for. Pure, so every row of the story's table is a plain value here.

const at = (...codePoints: number[]): string => String.fromCodePoint(...codePoints);

const list = (...emails: string[]) => emails.map((email) => ({ email }));

/** The address of the given length, `a` characters and `@example.org`. */
const addressOfLength = (length: number): string => `${'a'.repeat(length - '@example.org'.length)}@example.org`;

const NOT_VERIFIED = { ok: false, rule: 'email_not_verified' } as const;
const NONE_VERIFIED = { ok: false, rule: 'no_verified_email' } as const;
const found = (email: string) => ({ ok: true, email }) as const;

test.each([
  ['the same text', ['ada@example.org'], 'ada@example.org', 'ada@example.org'],
  ['a request in capitals', ['ada@example.org'], 'ADA@EXAMPLE.ORG', 'ada@example.org'],
  ['a request in mixed case', ['ada@example.org'], 'Ada@Example.Org', 'ada@example.org'],
  [
    'a verified address in mixed case, asked for in small letters',
    ['Ada@Example.org'],
    'ada@example.org',
    'Ada@Example.org',
  ],
  [
    'the second of two addresses',
    ['ada@example.org', 'lovelace@example.net'],
    'LOVELACE@example.net',
    'lovelace@example.net',
  ],
  ['a plus tag', ['ada+cla@example.org'], 'ADA+CLA@example.org', 'ada+cla@example.org'],
])('case does not matter and the answer keeps the casing of GitHub: %s', (_label, verified, requested, expected) => {
  expect(resolveSignerEmail(list(...verified), requested)).toStrictEqual(found(expected));
});

test.each([
  ['spaces', '  ada@example.org  '],
  ['a tab and a line feed', '\t\nada@example.org\r\n'],
  ['a no-break space', `${at(0xa0)}ada@example.org${at(0xa0)}`],
  ['an ideographic space and a byte order mark', `${at(0x3000)}ada@example.org${at(0xfeff)}`],
  ['spaces and capitals', ' ADA@example.ORG '],
])('white space around the request is ignored: %s', (_label, requested) => {
  expect(resolveSignerEmail(list('ada@example.org'), requested)).toStrictEqual(found('ada@example.org'));
});

test.each([
  ['white space inside the address', 'ada @example.org'],
  ['a Cyrillic a for the first letter', `${at(0x430)}da@example.org`],
  ['a Cyrillic e in the domain', `ada@${at(0x435)}xample.org`],
  ['a Greek omicron in the domain', `ada@ex${at(0x3bf)}mple.org`],
  ['a full-width at sign', `ada${at(0xff20)}example.org`],
  ['a zero width space inside', `ad${at(0x200b)}a@example.org`],
  ['a combining mark after the a', `a${at(0x301)}da@example.org`],
  ['a different local part', 'ada2@example.org'],
  ['a different domain', 'ada@example.net'],
  ['a subdomain', 'ada@mail.example.org'],
  ['the address of another person', 'grace@example.org'],
  ['half of the address', 'ada@'],
  ['nothing', ''],
  ['white space only', ' \t '],
])('an address that is not in the list is not matched: %s', (_label, requested) => {
  expect(resolveSignerEmail(list('ada@example.org', 'lovelace@example.net'), requested)).toStrictEqual(NOT_VERIFIED);
});

test.each([
  ['the Kelvin sign for k', `${at(0x212a)}ate@example.org`, 'kate@example.org'],
  ['the long s for s', `${at(0x17f)}am@example.org`, 'sam@example.org'],
  ['the dotted capital I for i', `${at(0x130)}vy@example.org`, 'ivy@example.org'],
  ['the dotless i for i', `${at(0x131)}vy@example.org`, 'ivy@example.org'],
  ['the sharp s for ss', `mi${at(0xdf)}@example.org`, 'miss@example.org'],
])(
  'only ASCII letters fold, so a character that merely lower-cases to a letter is not that letter: %s',
  (_label, requested, verified) => {
    expect(resolveSignerEmail(list(verified), requested)).toStrictEqual(NOT_VERIFIED);
    expect(resolveSignerEmail(list(verified), verified.toUpperCase())).toStrictEqual(found(verified));
  },
);

test('a non-ASCII address matches only when written the same way', () => {
  const verified = `${at(0xe9)}lise@example.org`;
  expect(resolveSignerEmail(list(verified), verified)).toStrictEqual(found(verified));
  expect(resolveSignerEmail(list(verified), `${at(0xc9)}lise@example.org`)).toStrictEqual(NOT_VERIFIED);
});

test('the list is the session of one viewer: an address verified for another viewer is not matched', () => {
  const adas = list('ada@example.org');
  const graces = list('grace@example.net', 'GRACE.HOPPER@example.net');
  expect(resolveSignerEmail(adas, 'grace@example.net')).toStrictEqual(NOT_VERIFIED);
  expect(resolveSignerEmail(graces, 'ada@example.org')).toStrictEqual(NOT_VERIFIED);
  expect(resolveSignerEmail(graces, 'grace.hopper@example.net')).toStrictEqual(found('GRACE.HOPPER@example.net'));
});

test.each([
  ['the same address twice', ['ada@example.org', 'ada@example.org'], 'ada@example.org', 'ada@example.org'],
  [
    'one address twice among others',
    ['x@example.org', 'ada@example.org', 'y@example.org', 'ada@example.org'],
    'ada@example.org',
    'ada@example.org',
  ],
  [
    'two casings, asked for with the second one',
    ['Ada@example.org', 'ada@example.org'],
    'ada@example.org',
    'ada@example.org',
  ],
  [
    'two casings, asked for with the first one',
    ['Ada@example.org', 'ada@example.org'],
    'Ada@example.org',
    'Ada@example.org',
  ],
  [
    'two casings, asked for with a third one',
    ['Ada@example.org', 'ADA@example.org'],
    'aDa@example.org',
    'Ada@example.org',
  ],
])('duplicates in the list give one answer: %s', (_label, verified, requested, expected) => {
  expect(resolveSignerEmail(list(...verified), requested)).toStrictEqual(found(expected));
});

test.each([
  ['an empty request', ''],
  ['an address', 'ada@example.org'],
  ['white space', '   '],
  ['a request over the limit', addressOfLength(SIGNER_EMAIL_MAX_LENGTH + 1)],
])('an empty list is no_verified_email whatever was asked: %s', (_label, requested) => {
  expect(resolveSignerEmail([], requested)).toStrictEqual(NONE_VERIFIED);
});

test('an address of 254 characters is matched, one of 255 is not even when the list holds it', () => {
  const longest = addressOfLength(SIGNER_EMAIL_MAX_LENGTH);
  const tooLong = addressOfLength(SIGNER_EMAIL_MAX_LENGTH + 1);
  expect(longest).toHaveLength(254);
  expect(tooLong).toHaveLength(255);
  expect(resolveSignerEmail(list(longest), longest)).toStrictEqual(found(longest));
  expect(resolveSignerEmail(list(longest), longest.toUpperCase())).toStrictEqual(found(longest));
  expect(resolveSignerEmail(list(tooLong), tooLong)).toStrictEqual(NOT_VERIFIED);
  expect(resolveSignerEmail(list(longest, tooLong), ` ${tooLong} `)).toStrictEqual(NOT_VERIFIED);
});

test('the length is that of the trimmed request: 254 characters between spaces is matched', () => {
  const longest = addressOfLength(SIGNER_EMAIL_MAX_LENGTH);
  expect(resolveSignerEmail(list(longest), `   ${longest}   `)).toStrictEqual(found(longest));
});

test('an empty address in the list is never matched by an empty request', () => {
  expect(resolveSignerEmail(list(''), '')).toStrictEqual(NOT_VERIFIED);
  expect(resolveSignerEmail(list(''), '  ')).toStrictEqual(NOT_VERIFIED);
});

test('an answer is always an address of the list, written as the viewer asked for it up to ASCII case', () => {
  const verified = list('Ada@Example.org', 'lovelace@example.net', `${at(0xe9)}lise@example.org`, 'a+b@example.org');
  const requests = [
    'ada@example.org',
    ' LOVELACE@EXAMPLE.NET ',
    `${at(0xc9)}LISE@example.org`,
    `${at(0xe9)}lise@EXAMPLE.org`,
    'A+B@example.org',
    'a+b@example.org ',
    'x@example.org',
    `${at(0x212a)}x@example.org`,
    'ada@example.org\u0000',
  ];
  for (const requested of requests) {
    const answer = resolveSignerEmail(verified, requested);
    if (answer.ok) {
      expect(verified.map((entry) => entry.email)).toContain(answer.email);
      const wanted = requested.trim();
      expect(answer.email).toHaveLength(wanted.length);
      expect(answer.email.replaceAll(/[A-Z]/gu, (c) => c.toLowerCase())).toBe(
        wanted.replaceAll(/[A-Z]/gu, (c) => c.toLowerCase()),
      );
    }
  }
  expect(requests.filter((requested) => resolveSignerEmail(verified, requested).ok)).toHaveLength(5);
});
