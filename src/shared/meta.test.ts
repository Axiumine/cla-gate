// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  commitSchema,
  DEFAULT_SOURCE_URL,
  installUrlFor,
  META_CACHE_CONTROL,
  metaResponseSchema,
  metaRoute,
  sourceCodeUrl,
  sourceUrlSchema,
} from './meta.ts';

// E17-S09: what the instance says about itself, and how the footer's source link is made from it.

const COMMIT = '0123456789abcdef0123456789abcdef01234567';

test('the compiled-in source address is itself an address the schema accepts', () => {
  expect(DEFAULT_SOURCE_URL).toBe('https://github.com/Axiumine/cla-gate');
  expect(sourceUrlSchema.safeParse(DEFAULT_SOURCE_URL).success).toBe(true);
});

test.each([
  ['an https address with a path', 'https://github.com/Axiumine/cla-gate'],
  ['an https address with a port', 'https://git.example.test:8443/org/repo'],
  ['an https origin alone', 'https://git.example.test'],
])('%s is a source address', (_name, value) => {
  expect(sourceUrlSchema.safeParse(value).success).toBe(true);
});

test.each([
  ['a javascript: address', 'javascript:alert(1)'],
  ['a data: address', 'data:text/html,<script>alert(1)</script>'],
  ['plain http', 'http://git.example.test/org/cla'],
  ['credentials', 'https://user:pw@github.com/Axiumine/cla-gate'],
  ['a user name alone', 'https://user@github.com/Axiumine/cla-gate'],
  ['a query', 'https://github.com/Axiumine/cla-gate?x=1'],
  ['an empty query', 'https://github.com/Axiumine/cla-gate?'],
  ['a fragment', 'https://github.com/Axiumine/cla-gate#readme'],
  ['a trailing slash', 'https://github.com/Axiumine/cla-gate/'],
  ['a space', 'https://github.com/Axiumine/cla gate'],
  ['a control character', 'https://github.com/Axiumine/cla\u0007gate'],
  ['a non-ASCII character', 'https://github.com/Axiumine/clä-gate'],
  ['a relative path', '/Axiumine/cla-gate'],
  ['an empty string', ''],
])('%s is not a source address', (_name, value) => {
  expect(sourceUrlSchema.safeParse(value).success).toBe(false);
});

test('a commit is 40 lower-case hexadecimal characters and nothing else', () => {
  expect(commitSchema.safeParse(COMMIT).success).toBe(true);
  for (const value of [COMMIT.slice(1), `${COMMIT}0`, COMMIT.toUpperCase(), `${COMMIT.slice(1)}g`, 'unknown', '']) {
    expect(commitSchema.safeParse(value).success, value).toBe(false);
  }
});

test('the install address is built from a slug of lower-case letters, digits and hyphens, and from nothing else', () => {
  expect(installUrlFor('cla-gate-test')).toBe('https://github.com/apps/cla-gate-test/installations/new');
  for (const slug of ['', 'Upper', 'a_b', 'a/b', 'a b', '../x', 'a?x=1', 'x\n']) {
    expect(installUrlFor(slug), JSON.stringify(slug)).toBeNull();
  }
});

test('the source link is the tree of the commit when it is known, and the repository when it is not', () => {
  expect(sourceCodeUrl(DEFAULT_SOURCE_URL, COMMIT)).toBe(`${DEFAULT_SOURCE_URL}/tree/${COMMIT}`);
  expect(sourceCodeUrl(DEFAULT_SOURCE_URL, null)).toBe(DEFAULT_SOURCE_URL);
});

test('the answer carries a source address, a commit or null, and an install address or null', () => {
  const install = 'https://github.com/apps/cla-gate-test/installations/new';
  const full = { sourceUrl: DEFAULT_SOURCE_URL, commit: COMMIT, installUrl: install };
  expect(metaResponseSchema.parse(full)).toEqual(full);
  const empty = { sourceUrl: DEFAULT_SOURCE_URL, commit: null, installUrl: null };
  expect(metaResponseSchema.parse(empty)).toEqual(empty);
  for (const bad of [
    { ...full, sourceUrl: 'javascript:alert(1)' },
    { ...full, commit: 'abc' },
    { ...full, installUrl: 'https://evil.example/apps/x/installations/new' },
    { ...full, installUrl: 'javascript:alert(1)' },
    { sourceUrl: DEFAULT_SOURCE_URL, commit: null },
  ]) {
    expect(metaResponseSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  }
});

test('the route is a public GET at /api/meta with no input, and the cache rule is five minutes', () => {
  expect([metaRoute.name, metaRoute.method, metaRoute.path]).toEqual(['GET /api/meta', 'GET', '/api/meta']);
  expect(Object.keys(metaRoute.responses)).toEqual(['200']);
  expect(META_CACHE_CONTROL).toBe('public, max-age=300');
});
