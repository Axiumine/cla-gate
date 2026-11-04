// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { checkAccountKind, snapshotOf } from './allowlist-entry.ts';

test.each([
  ['user', 'User', 'ok'],
  ['bot', 'Bot', 'ok'],
  ['user', 'Bot', 'use_other_kind'],
  ['bot', 'User', 'use_other_kind'],
  ['user', 'Organization', 'use_org_members'],
  ['bot', 'Organization', 'use_org_members'],
  ['user', 'Other', 'not_supported'],
  ['bot', 'Other', 'not_supported'],
] as const)('an entry of kind %s for an account of type %s is %s', (kind, type, expected) => {
  expect(checkAccountKind(kind, type)).toBe(expected);
});

test.each([
  ['a login', 'ada-lovelace'],
  ['a bot login', 'dependabot[bot]'],
])('%s is kept as the snapshot', (_name, login) => {
  expect(snapshotOf(login)).toBe(login);
});

test.each([
  ['markup', '<img src=x>'],
  ['an empty login', ''],
  ['a login with a slash', 'ada/lovelace'],
  ['a login of 40 characters', `a${'b'.repeat(39)}`],
])('%s is not kept: there is no snapshot', (_name, login) => {
  expect(snapshotOf(login)).toBeNull();
});
