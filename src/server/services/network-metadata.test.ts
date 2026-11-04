// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
/* eslint-disable sonarjs/no-hardcoded-ip -- the whole file feeds made-up addresses to the cleaning function; none is ever connected to */
import { expect, test } from 'vitest';
import {
  cleanAddress,
  cleanUserAgent,
  type NetworkSource,
  NO_NETWORK_METADATA,
  networkMetadataOf,
  USER_AGENT_MAX_LENGTH,
} from './network-metadata.ts';

// The cleaning of the optional network metadata of a signing (E13-S05): what of the client's address and `User-Agent` reaches
// a column. The request is read only when recording is on.

const refuseIp = (): string => {
  throw new Error('request.ip was read');
};
const refuseAgent = (): string => {
  throw new Error('the user-agent header was read');
};

/** Requests whose `ip`, `user-agent` or both throw when read: the proof that a code path did not read them. */
const IP_TRIPWIRE: NetworkSource = {
  get ip(): string {
    return refuseIp();
  },
  headers: {},
};
const AGENT_TRIPWIRE: NetworkSource = {
  ip: '203.0.113.7',
  headers: {
    get 'user-agent'(): string {
      return refuseAgent();
    },
  },
};
const TRIPWIRE: NetworkSource = {
  get ip(): string {
    return refuseIp();
  },
  headers: AGENT_TRIPWIRE.headers,
};

test('the limit is 512, the length the column allows', () => {
  expect(USER_AGENT_MAX_LENGTH).toBe(512);
});

test('with recording off the request is not read at all, and nothing is recorded', () => {
  expect(networkMetadataOf(TRIPWIRE, false)).toBe(NO_NETWORK_METADATA);
  expect(NO_NETWORK_METADATA).toEqual({ ipAddress: null, userAgent: null });
});

test.each([
  ['the address', { ip: '203.0.113.7', headers: {} }, { ipAddress: '203.0.113.7', userAgent: null }],
  [
    'the header',
    { ip: 'not an address', headers: { 'user-agent': 'Agent/1' } },
    { ipAddress: null, userAgent: 'Agent/1' },
  ],
  [
    'both',
    { ip: '2001:db8::1', headers: { 'user-agent': 'Agent/2' } },
    { ipAddress: '2001:db8::1', userAgent: 'Agent/2' },
  ],
])('with recording on the request is read, %s', (_label, request, expected) => {
  expect(networkMetadataOf(request, true)).toEqual(expected);
});

test.each([
  ['the address', IP_TRIPWIRE, 'request.ip was read'],
  ['the user agent', AGENT_TRIPWIRE, 'the user-agent header was read'],
])('with recording on %s is read: a request that refuses the read fails the call', (_label, request, message) => {
  expect(() => networkMetadataOf(request, true)).toThrow(message);
});

test.each([
  ['an IPv4 address', '203.0.113.7', '203.0.113.7'],
  ['an IPv6 address', '2001:db8::7', '2001:db8::7'],
  ['a full IPv6 address', '2001:0db8:0000:0000:0000:0000:0000:0007', '2001:0db8:0000:0000:0000:0000:0000:0007'],
  ['the IPv6 loopback', '::1', '::1'],
  ['an IPv4-mapped IPv6 address, kept as it is', '::ffff:203.0.113.9', '::ffff:203.0.113.9'],
  ['an empty string', '', null],
  ['a name', 'localhost', null],
  ['text from a forwarded-for header', "1.2.3.4'; drop table signer_pii; --", null],
  ['a list', '203.0.113.7, 198.51.100.1', null],
  ['an address with a port', '203.0.113.7:443', null],
  ['an IPv4 prefix', '203.0.113.0/24', null],
  ['an IPv6 address with a scope', 'fe80::1%eth0', null],
  ['an address with a leading zero', '203.0.113.07', null],
  ['an address with a newline', '203.0.113.7\n', null],
  ['an address with spaces', ' 203.0.113.7 ', null],
  ['an IPv4 address with 5 parts', '1.2.3.4.5', null],
])('the address is cleaned: %s', (_label, raw, expected) => {
  expect(cleanAddress(raw)).toBe(expected);
});

const ASTRAL = '\u{1F600}';

test.each([
  ['missing', undefined, null],
  ['empty', '', null],
  ['only control characters', '\u0000\n\r\t\u007f\u0085', null],
  ['plain', 'Mozilla/5.0 (X11; Linux x86_64)', 'Mozilla/5.0 (X11; Linux x86_64)'],
  ['a newline, removed and not replaced', 'Agent/1\nX-Injected: yes', 'Agent/1X-Injected: yes'],
  ['a carriage return and a tab', 'A\r\nB\tC', 'ABC'],
  ['NUL, which a text column cannot hold', 'a\u0000b', 'ab'],
  ['escape and DEL', '\u001b[31mred\u007f', '[31mred'],
  ['C1 controls', 'a\u0080b\u009fc', 'abc'],
  ['line and paragraph separators', 'a b c', 'abc'],
  ['leading and trailing spaces are kept', ' Agent ', ' Agent '],
  ['non-ASCII text is kept', 'Navigateur/é', 'Navigateur/é'],
])('the user agent is cleaned: %s', (_label, raw, expected) => {
  expect(cleanUserAgent(raw)).toBe(expected);
});

test.each([
  ['511', 511, 511],
  ['512', 512, 512],
  ['513', 513, 512],
  ['600', 600, 512],
  ['100000', 100_000, 512],
])('a user agent of %s characters is stored with at most 512', (_label, length, stored) => {
  const cleaned = cleanUserAgent('x'.repeat(length));
  expect(cleaned?.length).toBe(stored);
  expect(cleaned).toBe('x'.repeat(stored));
});

test('control characters are removed before the cut, so 512 characters of text remain', () => {
  expect(cleanUserAgent(`${'\n'.repeat(100)}${'y'.repeat(600)}`)).toBe('y'.repeat(512));
});

test('the cut counts characters, not UTF-16 units: no pair of surrogates is split, and the database counts the same', () => {
  const cleaned = cleanUserAgent(ASTRAL.repeat(600)) ?? '';
  expect(Array.from(cleaned)).toHaveLength(512);
  expect(cleaned).toBe(ASTRAL.repeat(512));
  expect(cleaned.isWellFormed()).toBe(true);
});
