// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { classifyAccount } from './classify.ts';
import { account } from './test-support.ts';
import { ACCOUNT_TYPES, type Account } from './types.ts';

// E08-S03: classification reads the account type and nothing else.

test.each([
  ['User', 'human'],
  ['Bot', 'bot'],
  ['Unknown', 'unknown'],
  ['Organization', 'other'],
  ['Mannequin', 'other'],
] as const)('a %s account is classified %s', (type, expected) => {
  expect(classifyAccount(account(1, type))).toBe(expected);
});

test('every account type has a class, so a new type cannot slip through unclassified', () => {
  expect(ACCOUNT_TYPES.map((type) => classifyAccount(account(1, type)))).toEqual([
    'human',
    'bot',
    'other',
    'other',
    'unknown',
  ]);
});

test('an account whose display data says dependabot[bot] but whose type is User is human', () => {
  const lookalike = { id: 5, type: 'User', appSlug: 'dependabot[bot]', login: 'dependabot[bot]' } as const;
  expect(classifyAccount(lookalike)).toBe('human');
});

test('a Bot with an ordinary-looking name and slug is still a bot', () => {
  const plain = { id: 5, type: 'Bot', appSlug: 'alice', login: 'alice', name: 'Alice Example' } as const;
  expect(classifyAccount(plain)).toBe('bot');
});

test('an account with a [bot] login and a type of Unknown stays unknown, never promoted to bot', () => {
  const trailerAccount = { id: 5, type: 'Unknown', login: 'renovate[bot]' } as const;
  expect(classifyAccount(trailerAccount)).toBe('unknown');
});

test.each([undefined, '', 'dependabot[bot]', 'web-flow', 'alice', 'x'.repeat(300)])(
  'the app slug %j changes the classification of no account type',
  (slug) => {
    for (const type of ACCOUNT_TYPES) {
      const withSlug: Account = slug === undefined ? account(7, type) : { id: 7, type, appSlug: slug };
      expect(classifyAccount(withSlug)).toBe(classifyAccount(account(7, type)));
    }
  },
);

test('the id plays no part either: the same type gives the same class for the edge ids', () => {
  const ids = [1, 2, 19_864_447, Number.MAX_SAFE_INTEGER];
  expect(ids.map((id) => classifyAccount(account(id, 'Bot')))).toEqual(['bot', 'bot', 'bot', 'bot']);
  expect(ids.map((id) => classifyAccount(account(id, 'User')))).toEqual(['human', 'human', 'human', 'human']);
});
