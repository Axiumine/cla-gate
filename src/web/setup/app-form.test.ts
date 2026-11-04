// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { APP_NAME_PATTERN } from '../../shared/setup.ts';
import { type AppFormValues, checkAppForm, defaultAppName } from './app-form.ts';

// E19-S07: the default App name and the check of the form, which is the shared schema of the manifest request.

const USER: AppFormValues = { ownerType: 'user', organisation: '', appName: 'CLA Gate', allowOtherAccounts: false };
const ORGANISATION: AppFormValues = { ...USER, ownerType: 'organisation', organisation: 'acme-inc' };

test.each([
  ['cla.example.org', 'CLA Gate cla-example-org'],
  ['localhost:3000', 'CLA Gate localhost-3000'],
  ['localhost', 'CLA Gate localhost'],
  ['[::1]:8080', 'CLA Gate -1-8080'],
  ['a_b.c', 'CLA Gate a-b-c'],
  ['xn--caf-dma.example', 'CLA Gate xn--caf-dma-example'],
])('the default name for the host %s is %j', (host, name) => {
  expect(defaultAppName(host)).toBe(name);
});

test.each([
  'cla.example.org',
  'localhost:3000',
  '[::1]:8080',
  'ünï.cödé.example',
  '<b>.example',
  `${'a'.repeat(80)}.example`,
])('the default name for %j is one the shared pattern accepts, 34 characters at most', (host) => {
  const name = defaultAppName(host);
  expect(APP_NAME_PATTERN.test(name)).toBe(true);
  expect(name.length).toBeLessThanOrEqual(34);
  expect(name.startsWith('CLA Gate ')).toBe(true);
});

test('a long host is cut at exactly 34 characters', () => {
  expect(defaultAppName('h'.repeat(60))).toBe(`CLA Gate ${'h'.repeat(25)}`);
  expect(defaultAppName('h'.repeat(60))).toHaveLength(34);
});

test('a personal App passes with no organisation, and its request holds none', () => {
  expect(checkAppForm(USER)).toEqual({
    valid: true,
    request: { ownerType: 'user', appName: 'CLA Gate', allowOtherAccounts: false },
  });
  expect(checkAppForm({ ...USER, organisation: 'not-sent', allowOtherAccounts: true })).toEqual({
    valid: true,
    request: { ownerType: 'user', appName: 'CLA Gate', allowOtherAccounts: true },
  });
});

test('an organisation App passes with a GitHub login and its request carries it', () => {
  expect(checkAppForm(ORGANISATION)).toEqual({
    valid: true,
    request: { ownerType: 'organisation', organisation: 'acme-inc', appName: 'CLA Gate', allowOtherAccounts: false },
  });
});

test.each(['', '-a', 'a-', 'a'.repeat(40), 'a b', 'a_b', 'a.b', 'a/b', '..', 'a?b', 'a#b', '<b>', 'é'])(
  'the organisation login %j is wrong, and only the organisation field is',
  (organisation) => {
    const check = checkAppForm({ ...ORGANISATION, organisation });
    expect(check.valid).toBe(false);
    expect(check.valid ? [] : [...check.wrong]).toEqual(['organisation']);
  },
);

test.each(['', 'a'.repeat(35), 'a.b', 'a_b', 'é', 'a/b', '<b>', 'a\nb', "a'b"])(
  'the App name %j is wrong, and only the name field is',
  (appName) => {
    const check = checkAppForm({ ...USER, appName });
    expect(check.valid).toBe(false);
    expect(check.valid ? [] : [...check.wrong]).toEqual(['appName']);
  },
);

test('both fields can be wrong at once, and a personal App never has a wrong organisation', () => {
  const both = checkAppForm({ ...ORGANISATION, organisation: '', appName: '' });
  expect(both.valid ? [] : [...both.wrong].toSorted((a, b) => a.localeCompare(b))).toEqual(['appName', 'organisation']);
  const personal = checkAppForm({ ...USER, organisation: '!!', appName: '' });
  expect(personal.valid ? [] : [...personal.wrong]).toEqual(['appName']);
});
