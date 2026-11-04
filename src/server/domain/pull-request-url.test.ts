// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { pullRequestUrl } from './pull-request-url.ts';

// E13-S02: the address of a pull request is built from the `owner/name` snapshot and the number, and from nothing else.

test.each([
  ['a plain name', 'acme/widgets', 45, 'https://github.com/acme/widgets/pull/45'],
  ['dots, dashes and underscores', 'my-org_1/my.repo-name_2', 1, 'https://github.com/my-org_1/my.repo-name_2/pull/1'],
  ['the largest number', 'acme/widgets', 2_147_483_647, 'https://github.com/acme/widgets/pull/2147483647'],
  ['a name that starts with a dot', 'acme/.github', 3, 'https://github.com/acme/.github/pull/3'],
  ['a name of 100 characters', `acme/${'a'.repeat(100)}`, 3, `https://github.com/acme/${'a'.repeat(100)}/pull/3`],
])('%s gives its address', (_what, fullName, prNumber, expected) => {
  expect(pullRequestUrl(fullName, prNumber)).toBe(expected);
});

test.each([
  ['an empty text', ''],
  ['no slash', 'acme'],
  ['two slashes', 'acme/widgets/extra'],
  ['an empty owner', '/widgets'],
  ['an empty name', 'acme/'],
  ['a name of 101 characters', `acme/${'a'.repeat(101)}`],
  ['an owner of 101 characters', `${'a'.repeat(101)}/widgets`],
  ['the dot name', 'acme/.'],
  ['the dot dot name', 'acme/..'],
  ['a query', 'acme/widgets?x=1'],
  ['a fragment', 'acme/widgets#x'],
  ['a host in the owner', 'evil.example/widgets'],
  ['a space', 'acme/wid gets'],
  ['a line break at the end', 'acme/widgets\n'],
  ['a backslash', 'acme\\widgets'],
  ['a percent escape', 'acme/%2e%2e'],
  ['a colon', 'acme:80/widgets'],
])('%s is put into no address', (_what, fullName) => {
  expect(pullRequestUrl(fullName, 7)).toBeNull();
});
