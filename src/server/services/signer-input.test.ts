// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { HOSTILE_CONTROL_NAMES, HOSTILE_NAMES } from '../../shared/hostile-names.ts';
import { SignRuleError } from './sign-rule-error.ts';
import { checkSignerInput } from './signer-input.ts';

// E13-S03: what a signer typed, checked against the verified addresses of the session. The rules come from the shared schema
// and the pure resolver, which have their own tests; this file shows how they are put together and that nothing typed leaks.

const VERIFIED = [
  { email: 'Ada@Example.org', primary: true },
  { email: 'lovelace@example.net', primary: false },
];

/** The rule that `checkSignerInput` throws for the input, or `null` when it does not throw. */
function ruleOf(input: Parameters<typeof checkSignerInput>[0], verified = VERIFIED): string | null {
  try {
    checkSignerInput(input, verified);
    return null;
  } catch (error) {
    return error instanceof SignRuleError ? error.rule : 'not a SignRuleError';
  }
}

test('the name is cleaned and the address is the one GitHub reported, not the one that was typed', () => {
  expect(checkSignerInput({ name: '  Ada   Lovelace ', email: ' ADA@example.ORG ' }, VERIFIED)).toStrictEqual({
    name: 'Ada Lovelace',
    email: 'Ada@Example.org',
  });
});

test.each(HOSTILE_NAMES.map((name) => [name.slice(0, 40), name] as const))(
  'the hostile name %j is the name to record, unchanged',
  (_label, name) => {
    expect(checkSignerInput({ name, email: 'lovelace@example.net' }, VERIFIED).name).toBe(name);
  },
);

test.each(HOSTILE_CONTROL_NAMES.map((name) => [name.slice(0, 40), name] as const))(
  'the hostile control name %j is invalid_name',
  (_label, name) => {
    expect(ruleOf({ name, email: 'lovelace@example.net' })).toBe('invalid_name');
  },
);

test.each([
  ['an address that is not in the list', { name: 'Ada', email: 'grace@example.net' }, VERIFIED, 'email_not_verified'],
  [
    'an address over 254 characters',
    { name: 'Ada', email: `${'a'.repeat(260)}@example.org` },
    VERIFIED,
    'email_not_verified',
  ],
  ['no address at all', { name: 'Ada', email: '' }, VERIFIED, 'email_not_verified'],
  ['an empty list', { name: 'Ada', email: 'ada@example.org' }, [], 'no_verified_email'],
  ['an empty name', { name: '   ', email: 'ada@example.org' }, VERIFIED, 'invalid_name'],
  ['a name and an address that both fail', { name: 'Ada\n', email: 'grace@example.net' }, VERIFIED, 'invalid_name'],
  ['a bad name and an empty list', { name: 'Ada\n', email: 'ada@example.org' }, [], 'invalid_name'],
])('%s is %s', (_label, input, verified, rule) => {
  expect(ruleOf(input, verified)).toBe(rule);
});

test('the error is the rule and nothing typed: not in its message, its fields or its stack', () => {
  const name = `zzzz-name${String.fromCodePoint(0x202e)}`;
  const email = 'zzzz-address@example.org';
  for (const input of [
    { name, email: 'ada@example.org' },
    { name: 'Ada', email },
  ]) {
    let caught: unknown;
    try {
      checkSignerInput(input, VERIFIED);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SignRuleError);
    if (caught instanceof SignRuleError) {
      expect(caught.message).toBe(caught.rule);
      expect(`${caught.stack} ${JSON.stringify(caught)} ${caught.name}`).not.toContain('zzzz');
    }
  }
});
