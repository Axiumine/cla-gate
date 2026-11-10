// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { inspect } from 'node:util';
import { expect, test } from 'vitest';
import { mask, Secret } from './secret.ts';

const VALUE = 'ghs_super-secret-value';

test('reveal returns the value', () => {
  expect(new Secret(VALUE).reveal()).toBe(VALUE);
});

test.each([
  ['String()', (secret: Secret) => String(secret)],
  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- the point of the test: interpolating a Secret must not leak it
  ['a template literal', (secret: Secret) => `token=${secret}`],
  // biome-ignore lint/style/useTemplate: the point of the test is concatenation, not a template
  ['concatenation', (secret: Secret) => 'token=' + secret], // eslint-disable-line @typescript-eslint/restrict-plus-operands -- a Secret must not leak when concatenated
  ['JSON.stringify', (secret: Secret) => JSON.stringify({ secret })],
  ['util.inspect', (secret: Secret) => inspect({ nested: { secret } }, { depth: 5 })],
  ['console formatting', (secret: Secret) => inspect(secret)],
  ['Object.keys and entries', (secret: Secret) => JSON.stringify([Object.keys(secret), Object.entries(secret)])],
  ['structuredClone', (secret: Secret) => JSON.stringify(structuredClone(secret))],
])('%s never prints the value', (_name, print) => {
  const printed = print(new Secret(VALUE));
  expect(printed).not.toContain(VALUE);
  expect(printed).not.toContain('super-secret');
});

test('the mask is the literal [REDACTED]', () => {
  expect(mask()).toBe('[REDACTED]');
  expect(String(new Secret(VALUE))).toBe('[REDACTED]');
  expect(JSON.stringify({ secret: new Secret(VALUE) })).toBe('{"secret":"[REDACTED]"}');
});

test.each([
  ['toString', (secret: Secret) => secret.toString()],
  ['toJSON', (secret: Secret) => secret.toJSON()],
  ['inspect', (secret: Secret) => inspect(secret)],
  ['String()', (secret: Secret) => String(secret)],
])('%s returns the mask', (_name, print) => {
  expect(print(new Secret(VALUE))).toBe(mask());
});
