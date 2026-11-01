// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
/* eslint-disable sonarjs/no-hardcoded-ip -- the whole file feeds IP addresses and CIDRs to a parser; none is ever connected to */
import { expect, test } from 'vitest';
import { parseTrustProxy } from './trust-proxy.ts';

test.each([
  ['true', true],
  ['false', false],
  [' TRUE ', true],
  ['0', 0],
  ['1', 1],
  ['12', 12],
  ['127.0.0.1', ['127.0.0.1']],
  ['10.0.0.0/8, 127.0.0.1', ['10.0.0.0/8', '127.0.0.1']],
  ['::1', ['::1']],
  ['2001:db8::/32', ['2001:db8::/32']],
  ['192.168.0.0/32', ['192.168.0.0/32']],
  ['2001:db8::/128', ['2001:db8::/128']],
  ['10.0.0.0/1', ['10.0.0.0/1']],
  ['::/1', ['::/1']],
])('%j parses to %j', (raw, expected) => {
  expect(parseTrustProxy(raw)).toEqual(expected);
});

test.each([
  [''],
  ['yes'],
  ['1000'],
  ['-1'],
  ['1.5'],
  ['10.0.0.0/33'],
  ['2001:db8::/129'],
  ['0.0.0.0/0'],
  ['127.0.0.1/0'],
  ['::/0'],
  ['10.0.0.0/8, 192.168.0.0/0'],
  ['10.0.0.0/abc'],
  ['10.0.0.0/8/8'],
  ['example.com'],
  ['127.0.0.1,'],
  ['127.0.0.1, nope'],
])('%j is rejected rather than trusted', (raw) => {
  expect(parseTrustProxy(raw)).toBeUndefined();
});
