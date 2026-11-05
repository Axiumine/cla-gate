// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { FREE_MAIL_DOMAINS, isFreeMailDomain } from './free-mail-domains.ts';

// The free-mail domains an approval refuses (E21-S03): the list of the story, spelled out here on purpose, and an exact comparison.

const LISTED = [
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'proton.me',
  'protonmail.com',
  'aol.com',
  'gmx.com',
  'mail.com',
  'yandex.com',
  'zoho.com',
];

test('the list is the sixteen domains of the story, and no other', () => {
  expect([...FREE_MAIL_DOMAINS].toSorted((a, b) => a.localeCompare(b))).toEqual(
    LISTED.toSorted((a, b) => a.localeCompare(b)),
  );
});

test.each(LISTED)('%s is a free-mail domain', (domain) => {
  expect(isFreeMailDomain(domain)).toBe(true);
});

test.each([
  ['a subdomain of a listed domain', 'corp.gmail.com'],
  ['a listed domain followed by more labels', 'gmail.com.evil.test'],
  ['a name that ends like a listed domain', 'notgmail.com'],
  ['a name that starts like a listed domain', 'gmail.co'],
  ['a company domain', 'acme.example'],
  ['the empty string', ''],
  ['a listed domain in capitals, which is not the stored form', 'GMAIL.COM'],
  ['a listed domain with a trailing dot', 'gmail.com.'],
])('%s is not one', (_label, domain) => {
  expect(isFreeMailDomain(domain)).toBe(false);
});
