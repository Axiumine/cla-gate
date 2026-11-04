// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { decodedPathname, isSetupUrl } from './spa-url.ts';

// E17-S03 and E19-S06: how the file routes read a request target, and which targets are the setup page.

test.each([
  ['/signatures', '/signatures'],
  ['/signatures?a=1', '/signatures'],
  ['/a%2eb', '/a.b'],
  ['/caf%C3%A9?x=%zz', '/café'],
  ['/a%2Fb', '/a%2Fb'],
  ['/', '/'],
])('the path of %s is %s', (url, expected) => {
  expect(decodedPathname(url)).toBe(expected);
});

test('an escape that cannot be decoded has no path', () => {
  expect(decodedPathname('/%E0%A4%A')).toBeUndefined();
  expect(decodedPathname('/a%')).toBeUndefined();
});

test.each([
  '/setup',
  '/setup/',
  '/setup/callback',
  '/setup/callback?code=abc&state=def',
  '/SETUP',
  '/Setup/Callback',
  '/set%75p',
  '/setup/%63allback',
])('%s is the setup page or below it', (url) => {
  expect(isSetupUrl(url)).toBe(true);
});

test.each([
  '/',
  '/setup-guide',
  '/setupx',
  '/setupx/callback',
  '/settings',
  '/api/setup/status',
  '/a/setup',
  '/setu',
  '/%E0%A4%A',
  '/setup%',
])('%s is not', (url) => {
  expect(isSetupUrl(url)).toBe(false);
});
