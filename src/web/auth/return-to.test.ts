// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { buildReturnTo, loginStartUrl, returnPathOf } from './return-to.ts';

// E17-S08: the path the login ends at is the page the person was on, and nothing a stranger wrote into the address bar can
// turn it into another site.

test.each([
  ['the front page', '/'],
  ['a page', '/dashboard'],
  ['a sign link with a query string', '/sign/123?pr=45'],
  ['a path with an escaped slash-free query', '/search?q=abc&page=2'],
  ['a path of 512 characters', `/${'a'.repeat(511)}`],
])('%s is kept as it is', (_what, path) => {
  expect(buildReturnTo(path)).toBe(path);
});

test.each([
  ['a protocol-relative address', '//evil.example'],
  ['a protocol-relative address with a path', '//evil.example/login'],
  ['a backslash after the slash', '/\\evil'],
  ['two backslashes', '\\\\evil.example'],
  ['a backslash further in', '/a\\b'],
  ['an absolute address', 'https://evil.example'],
  ['a script address', 'javascript:alert(1)'],
  ['a data address', 'data:text/html,x'],
  ['a relative path', 'dashboard'],
  ['nothing', ''],
  ['a tab', '/\t/evil.example'],
  ['a line feed', '/a\nb'],
  ['a null character', '/a\u0000b'],
  ['a delete character', '/a\u007fb'],
  ['a C1 control character', '/a\u0085b'],
  ['a space', '/a b'],
  ['a path of 513 characters', `/${'a'.repeat(512)}`],
])('%s is replaced by the front page', (_what, path) => {
  expect(buildReturnTo(path)).toBe('/');
});

test.each([
  ['an escaped backslash', '/%5Cevil'],
  ['an escaped backslash in lower case', '/%5cevil.example'],
  ['an escaped slash after the slash', '/%2Fevil.example'],
  ['an escaped slash twice', '/%2F%2Fevil.example'],
  ['an escaped slash in the middle', '/%2F/evil.example'],
  ['escaped line breaks that hide a header', '/%0d%0aSet-Cookie:x'],
  ['an escaped null', '/a%00b'],
  ['an escaped space, which the server would refuse too', '/a%20b'],
  ['an escaped tab', '/%09/evil.example'],
  ['a malformed escape', '/%E0%A4%A'],
  ['an escaped address', '%2F%2Fevil.example'],
  ['an escaped script address', 'javascript%3Aalert(1)'],
])('%s is replaced by the front page too', (_what, path) => {
  expect(buildReturnTo(path)).toBe('/');
});

test('the login start address carries the checked path, escaped, as return_to', () => {
  expect(loginStartUrl('/sign/123?pr=45&x=y')).toBe('/api/auth/login?return_to=%2Fsign%2F123%3Fpr%3D45%26x%3Dy');
});

test('a hostile path reaches the login start as the front page, never as itself', () => {
  expect(loginStartUrl('//evil.example')).toBe('/api/auth/login?return_to=%2F');
  expect(loginStartUrl('https://evil.example')).toBe('/api/auth/login?return_to=%2F');
});

test('without a path the login start address has no parameter, and the server sends the person to the front page', () => {
  expect(loginStartUrl()).toBe('/api/auth/login');
});

test('the path of a page is its pathname and its query string, and the failed-login page has none', () => {
  expect(returnPathOf('/sign/42', '?pr=7')).toBe('/sign/42?pr=7');
  expect(returnPathOf('/dashboard', '')).toBe('/dashboard');
  expect(returnPathOf('/login/failed', '?reason=access_denied')).toBeUndefined();
});
