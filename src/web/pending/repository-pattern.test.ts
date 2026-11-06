// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { HOSTILE_CONTROL_NAMES, HOSTILE_NAMES } from '../../shared/hostile-names.ts';
import { pullRequestUrl } from './repository-pattern.ts';

// E18-S08: the address of a pull request on GitHub is built only from a repository name that has the shape of one.

test.each([
  ['acme/widgets', 45, 'https://github.com/acme/widgets/pull/45'],
  ['a/b', 1, 'https://github.com/a/b/pull/1'],
  ['Acme-Corp/cla_gate.v2', 7, 'https://github.com/Acme-Corp/cla_gate.v2/pull/7'],
  ['acme/.github', 3, 'https://github.com/acme/.github/pull/3'],
  ['acme/...', 3, 'https://github.com/acme/.../pull/3'],
])('%s #%d is %s', (fullName, number, url) => {
  expect(pullRequestUrl(fullName, number)).toBe(url);
});

test.each([
  ['a name that is a dot', 'acme/.'],
  ['a name that is two dots', 'acme/..'],
  ['no name', 'acme/'],
  ['no owner', '/widgets'],
  ['no slash', 'acme'],
  ['three parts', 'acme/widgets/extra'],
  ['a space', 'acme/wid gets'],
  ['a query', 'acme/widgets?x=1'],
  ['a fragment', 'acme/widgets#1'],
  ['a dot in the owner', 'ac.me/widgets'],
  ['an underscore in the owner', 'ac_me/widgets'],
  ['an owner of 40 characters', `${'a'.repeat(40)}/widgets`],
  ['a name of 101 characters', `acme/${'a'.repeat(101)}`],
  ['a line break at the end', 'acme/widgets\n'],
  ['an escape', 'acme/%2e%2e'],
  ['a backslash', 'acme\\widgets'],
])('a name with %s is no repository name: %j has no address', (_what, fullName) => {
  expect(pullRequestUrl(fullName, 1)).toBeUndefined();
});

test('the longest names GitHub allows are still names', () => {
  expect(pullRequestUrl(`${'a'.repeat(39)}/${'b'.repeat(100)}`, 1)).toBe(
    `https://github.com/${'a'.repeat(39)}/${'b'.repeat(100)}/pull/1`,
  );
});

test.each(
  [...HOSTILE_NAMES, ...HOSTILE_CONTROL_NAMES].map((name) => [JSON.stringify(name).slice(0, 40), name] as const),
)('the hostile name %s has no address', (_label, name) => {
  expect(pullRequestUrl(name, 1)).toBeUndefined();
});

test('an address that is built always names github.com and nothing else, once parsed', () => {
  const url = pullRequestUrl('acme/widgets', 45);
  expect(new URL(String(url)).origin).toBe('https://github.com');
  expect(new URL(String(url)).pathname).toBe('/acme/widgets/pull/45');
});
