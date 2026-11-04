// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { z } from 'zod';
import { addConfigIssue, issuesOf, ruleOf } from './env-rules.ts';
import { envSchema } from './env-schema.ts';

// E19-S02: the rule that a variable failed is written in env-rules.ts, one per variable of the schema, and never taken from
// the input or from the message of a validator.

const NAMES = Object.keys(envSchema.shape);

test.each(NAMES)('%s has a rule that is a sentence of its own, with no value in it', (name) => {
  const rule = ruleOf(name);
  expect(rule).not.toBe(ruleOf('NOT_A_VARIABLE'));
  expect(rule).toMatch(/^[a-z]/);
  expect(rule.length).toBeGreaterThan(8);
});

test('a name that is not in the schema gets the plain fallback', () => {
  expect(ruleOf('NOT_A_VARIABLE')).toBe('is invalid');
});

test('the rule of PUBLIC_BASE_URL is the one the story gives as its example', () => {
  expect(ruleOf('PUBLIC_BASE_URL')).toBe(
    'must be an origin such as https://cla.example.com (scheme and host only); https is required when NODE_ENV=production',
  );
});

test('the issues of a failed parse are one per variable, with the rule of the variable and not the message of the validator', () => {
  const result = envSchema.safeParse({ PORT: 'LEAKCANARY', LOG_LEVEL: 'LEAKCANARY' });
  expect(result.success).toBe(false);
  expect(result.error && issuesOf(result.error)).toEqual([
    { variable: 'PORT', rule: ruleOf('PORT') },
    { variable: 'LOG_LEVEL', rule: ruleOf('LOG_LEVEL') },
    { variable: 'DATABASE_URL', rule: ruleOf('DATABASE_URL') },
  ]);
});

test('a variable that fails twice is reported once, with the first rule', () => {
  const schema = z.object({ A: z.string().min(5) }).superRefine((_value, ctx) => {
    ctx.addIssue({ code: 'custom', path: ['A'], message: 'second' });
    addConfigIssue(ctx, { variable: 'A', rule: 'third' });
  });
  const result = schema.safeParse({ A: 'x' });
  expect(result.error && issuesOf(result.error)).toEqual([{ variable: 'A', rule: 'is invalid' }]);
});

test('a cross-field rule travels with its issue and replaces the rule of the variable', () => {
  const schema = z.object({ A: z.string().optional() }).superRefine((_value, ctx) => {
    addConfigIssue(ctx, { variable: 'A', rule: 'must differ from B' });
  });
  const result = schema.safeParse({});
  expect(result.error && issuesOf(result.error)).toEqual([{ variable: 'A', rule: 'must differ from B' }]);
});

test('an issue without a variable (the whole input is wrong) has nothing to name and is left out', () => {
  const result = z.object({ A: z.string() }).safeParse('LEAKCANARY');
  expect(result.error && issuesOf(result.error)).toEqual([]);
});

test('an issue whose rule parameter is not text is told the rule of its variable', () => {
  const schema = z.object({ PORT: z.string().optional() }).superRefine((_value, ctx) => {
    ctx.addIssue({ code: 'custom', path: ['PORT'], message: 'x', params: { rule: 42 } });
  });
  const result = schema.safeParse({});
  expect(result.error && issuesOf(result.error)).toEqual([{ variable: 'PORT', rule: ruleOf('PORT') }]);
});
