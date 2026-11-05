// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { domainOfEmail, emailMatchesDomain, normaliseDomain } from './corporate-domain.ts';

// The form of an approved e-mail domain (E21-S03): lower case, punycode, a dotted hostname, and a comparison that is an equality.

test.each([
  ['a plain domain', 'acme.com', 'acme.com'],
  ['capitals and white space around', ' Acme.COM \n', 'acme.com'],
  ['an internationalised name, as its punycode form', 'bücher.example', 'xn--bcher-kva.example'],
  ['the same name with a combining mark', 'bücher.example', 'xn--bcher-kva.example'],
  ['a name already in punycode, in capitals', 'XN--BCHER-KVA.example', 'xn--bcher-kva.example'],
  ['a name in a script of its own', '例え.テスト', 'xn--r8jz45g.xn--zckzah'],
  ['a name that only starts like another', 'acme.com.evil.test', 'acme.com.evil.test'],
  ['labels with digits and inner hyphens', 'a-1.b2-c.example', 'a-1.b2-c.example'],
  ['a label of 63 characters', `${'a'.repeat(63)}.com`, `${'a'.repeat(63)}.com`],
  ['a top-level label with digits', 'acme.x1', 'acme.x1'],
])('%s is stored as the normal form', (_label, typed, stored) => {
  expect(normaliseDomain(typed)).toBe(stored);
});

test.each([
  ['nothing', ''],
  ['white space only', ' \t\n '],
  ['one label', 'localhost'],
  ['a trailing dot', 'acme.com.'],
  ['a leading dot', '.acme.com'],
  ['an empty label', 'acme..com'],
  ['an IPv4 address', '192.0.2.1'],
  ['an address in the shorthand a URL parser expands', '0x7f.1'],
  ['an address in a decimal form', '2130706433.com1'.replace('com1', '0')],
  ['an IPv6 address', '[::1]'],
  ['a port', 'acme.com:8080'],
  ['a scheme', 'https://acme.com'],
  ['a user name', 'ada@acme.com'],
  ['a path', 'acme.com/login'],
  ['a query', 'acme.com?x=1'],
  ['a fragment', 'acme.com#x'],
  ['a backslash', 'acme.com\\evil.test'],
  ['a wildcard', '*.acme.com'],
  ['a space inside', 'ac me.com'],
  ['an underscore', 'ac_me.com'],
  ['a percent escape', 'ac%6De.com'],
  ['a zero-width space the Unicode mapping would drop', 'ac​me.com'],
  ['a soft hyphen the Unicode mapping would drop', 'ac­me.com'],
  ['an ideographic full stop the Unicode mapping would turn into a dot', 'acme。com'],
  ['a punycode label that is not punycode', 'xn--a.example'],
  ['a combining mark with nothing to combine with', '\u0301a.example'],
  ['a hyphen at the start of a label', '-acme.com'],
  ['a hyphen at the end of a label', 'acme-.com'],
  ['a top-level label that starts with a digit', 'acme.1com'],
  ['a label of 64 characters', `${'a'.repeat(64)}.com`],
  ['a name of more than 253 characters', `${['a', 'b', 'c', 'd', 'e'].map((c) => c.repeat(60)).join('.')}.com`],
  ['more than anyone could mean', `${'a'.repeat(1100)}.com`],
])('%s is not a domain', (_label, typed) => {
  expect(normaliseDomain(typed)).toBeNull();
});

test('a name of 253 characters is the longest there is', () => {
  const longest = `${['a', 'b', 'c'].map((c) => c.repeat(63)).join('.')}.${'e'.repeat(61)}`;
  expect(longest).toHaveLength(253);
  expect(normaliseDomain(longest)).toBe(longest);
  expect(normaliseDomain(`${longest}e`)).toBeNull();
});

test.each([
  ['ada@acme.com', 'acme.com'],
  ['Ada@ACME.com', 'acme.com'],
  ['"odd@local"@acme.com', 'acme.com'],
  ['ada@bücher.example', 'xn--bcher-kva.example'],
  ['ada@acme.com.evil.test', 'acme.com.evil.test'],
])('the domain of the address %s is %s', (email, domain) => {
  expect(domainOfEmail(email)).toBe(domain);
});

test.each([
  ['no @', 'acme.com'],
  ['no local part', '@acme.com'],
  ['no domain', 'ada@'],
  ['a domain with no dot', 'ada@localhost'],
  ['an address in place of a domain', 'ada@192.0.2.1'],
])('an address with %s has no domain', (_label, email) => {
  expect(domainOfEmail(email)).toBeNull();
});

test.each([
  ['the same domain', 'ada@acme.com', 'acme.com', true],
  ['the same domain in capitals', 'ADA@ACME.COM', 'acme.com', true],
  ['an internationalised domain and its punycode form', 'ada@bücher.example', 'xn--bcher-kva.example', true],
  ['a subdomain of the approved domain', 'ada@mail.acme.com', 'acme.com', false],
  ['the parent of the approved domain', 'ada@acme.com', 'mail.acme.com', false],
  ['a longer name that starts with the approved domain', 'ada@acme.com.evil.test', 'acme.com', false],
  ['a longer name that ends with the approved domain', 'ada@notacme.com', 'acme.com', false],
  ['a name that contains the approved domain after the @ in the local part', 'acme.com@evil.test', 'acme.com', false],
  ['an address with no domain', 'ada@', 'acme.com', false],
])('%s: the address %s against the approval of %s is %s, by equality only', (_label, email, approved, covered) => {
  expect(emailMatchesDomain(email, approved)).toBe(covered);
});
