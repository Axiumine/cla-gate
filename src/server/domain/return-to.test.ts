// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { safeReturnTo } from './return-to.ts';

// The return path of a login (E10-S04): a relative path on this site, or `/`, and never an error.

test.each([
  ['a scheme-relative address', '//evil.example'],
  ['a slash and a backslash', '/\\evil.example'],
  ['two backslashes', '\\\\evil.example'],
  ['an absolute address', 'https://evil.example'],
  ['a script address', 'javascript:alert(1)'],
  ['a tab inside', '/\t/evil.example'],
  ['an encoded line break', '/%0d%0aSet-Cookie:x'],
  ['a dot-dot segment before a double slash', '/..//evil.example'],
  ['513 characters', `/${'a'.repeat(512)}`],
  ['511 CJK characters, which resolve to 4599', `/${'中'.repeat(511)}`],
  ['400 accented characters, which resolve to 2401', `/${'é'.repeat(400)}`],
  ['an accented path that resolves to 513 characters', `/${'é'.repeat(85)}aa`],
  ['an empty string', ''],
  ['no leading slash', 'dashboard'],
  ['a query only', '?next=/dashboard'],
  ['a leading space', ' /dashboard'],
  ['a trailing newline', '/dashboard\n'],
  ['a space inside', '/sign/1 2'],
  ['a no-break space', '/sign/1 2'],
  ['an NEL control character (C1)', '/sign\u00851'],
  ['DEL', '/sign\u007f1'],
  ['a null character', '/sign\u00001'],
  ['a backslash in the query', '/sign?next=a\\b'],
  ['an encoded backslash', '/%5Cevil.example'],
  ['an encoded tab', '/%09/evil.example'],
  ['an encoded slash after the first', '/%2F/evil.example'],
  ['an encoded dot-dot before a double slash', '/%2e%2e//evil.example'],
  ['a dot segment before a double slash', '/.//evil.example'],
  ['a dot-dot after a directory', '/a/..//evil.example'],
  ['a malformed percent escape', '/sign/%zz'],
  ['a lone percent sign', '/discount?off=100%'],
  ['a truncated multi-byte escape', '/%E4%B8'],
  ['a missing value', undefined],
])('%s becomes /', (_label, raw) => {
  expect(safeReturnTo(raw)).toBe('/');
});

test.each([
  ['the front page', '/', '/'],
  ['a page', '/dashboard', '/dashboard'],
  ['a sign page with a query string', '/sign/123?pr=45', '/sign/123?pr=45'],
  ['a nested path', '/orgs/42/repos/7', '/orgs/42/repos/7'],
  ['a fragment', '/dashboard#top', '/dashboard#top'],
  ['an encoded slash inside a segment', '/files/a%2Fb', '/files/a%2Fb'],
  ['a query whose value holds slashes', '/sign/1?next=%2Fdashboard%2F', '/sign/1?next=%2Fdashboard%2F'],
  ['exactly 512 characters', `/${'a'.repeat(511)}`, `/${'a'.repeat(511)}`],
  ['an accented path that resolves to exactly 512 characters', `/${'é'.repeat(85)}a`, `/${'%C3%A9'.repeat(85)}a`],
])('%s is kept', (_label, raw, expected) => {
  expect(safeReturnTo(raw)).toBe(expected);
});

test.each([
  ['dot segments are applied', '/a/b/../c', '/a/c'],
  ['a dot-dot above the root stops at the root', '/../dashboard', '/dashboard'],
  ['a character outside ASCII is percent-encoded, so the Location header stays valid', '/café', '/caf%C3%A9'],
  ['a CJK character is percent-encoded', '/中', '/%E4%B8%AD'],
  ['a quote in the query is percent-encoded', "/s?q='x'", '/s?q=%27x%27'],
])('%s', (_label, raw, expected) => {
  expect(safeReturnTo(raw)).toBe(expected);
});

test('the answer is never longer than the 512 characters the value may have, whatever it is encoded to', () => {
  const inputs = ['é', '中', '😀', '%E4%B8%AD', 'a', '/', "'"].flatMap((unit) =>
    [1, 50, 85, 170, 511].map((count) => `/${unit.repeat(count)}`),
  );
  for (const raw of inputs) {
    expect(safeReturnTo(raw).length).toBeLessThanOrEqual(512);
  }
});

test('the answer is printable ASCII for any input, so it can always be a header value', () => {
  const inputs = ['/é中😀', '/a?b=é#中', '/\ud800', '/ x', '/​x'];
  for (const raw of inputs) {
    expect(safeReturnTo(raw)).toMatch(/^\/[\x21-\x7e]*$/);
  }
});
