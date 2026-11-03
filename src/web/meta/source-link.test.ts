// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { DEFAULT_SOURCE_URL } from '../../shared/meta.ts';
import { sourceLinkOf } from './source-link.ts';

// E17-S09: the link of the footer, made only from what passes the same schemas as the server's.

const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const FALLBACK = { href: DEFAULT_SOURCE_URL, commit: null };

test('before the answer there is, and the repository is the compiled-in one', () => {
  expect(sourceLinkOf(undefined)).toEqual(FALLBACK);
});

test('a known commit links to its tree and is handed back for the short form', () => {
  expect(sourceLinkOf({ sourceUrl: 'https://git.example.test/org/cla', commit: COMMIT })).toEqual({
    href: `https://git.example.test/org/cla/tree/${COMMIT}`,
    commit: COMMIT,
  });
});

test('an unknown commit links to the repository itself, and a commit that is not a full id counts as unknown', () => {
  expect(sourceLinkOf({ sourceUrl: 'https://git.example.test/org/cla', commit: null })).toEqual({
    href: 'https://git.example.test/org/cla',
    commit: null,
  });
  expect(sourceLinkOf({ sourceUrl: 'https://git.example.test/org/cla', commit: 'abc1234' })).toEqual({
    href: 'https://git.example.test/org/cla',
    commit: null,
  });
});

test.each([
  ['javascript:alert(1)'],
  ['JavaScript:alert(1)'],
  ['data:text/html,<script>alert(1)</script>'],
  ['vbscript:msgbox(1)'],
  ['http://git.example.test/org/cla'],
  ['https://user:pw@git.example.test/org/cla'],
  ['https://git.example.test/org/cla?next=//evil.example'],
  ['//evil.example/org/cla'],
  ['/org/cla'],
  [''],
])('a source address of %j is not used as an href: the compiled-in repository is', (sourceUrl) => {
  expect(sourceLinkOf({ sourceUrl, commit: COMMIT })).toEqual(FALLBACK);
});
