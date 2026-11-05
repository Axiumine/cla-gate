// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { installationIdOf, parseInstallationId } from './installation-params.ts';

// E18-S04: what the address of an installation may hold.

test.each([
  ['1', 1],
  ['5', 5],
  ['987654321', 987654321],
  ['9007199254740991', Number.MAX_SAFE_INTEGER],
])('the installation id %s is %i', (raw, expected) => {
  expect(parseInstallationId(raw)).toBe(expected);
});

test.each([
  '',
  '0',
  '05',
  '-1',
  '+1',
  '1.0',
  '1e3',
  '0x1F',
  ' 5',
  '5 ',
  '5\n',
  'abc',
  '12abc',
  '١٢٣',
  '9007199254740992',
  '99999999999999999',
])('%j is not an installation id', (raw) => {
  expect(parseInstallationId(raw)).toBeUndefined();
});

test.each([
  [{ installationId: 5 }, 5],
  [{ installationId: 5, other: 'x' }, 5],
])('the installation id of the params %j is %i', (params, expected) => {
  expect(installationIdOf(params)).toBe(expected);
});

test.each([
  undefined,
  null,
  'installationId',
  7,
  {},
  { githubRepoId: 5 },
  { installationId: '5' },
  { installationId: undefined },
])('the params %j hold no installation id', (params) => {
  expect(installationIdOf(params)).toBeUndefined();
});
