// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ResolverResult } from 'react-hook-form';
import { expect, test } from 'vitest';
import { HOSTILE_NAMES } from '../../shared/hostile-names.ts';
import { SIGNER_RULE_STATUS } from '../../shared/signer-input.ts';
import { ApiError, ContractError } from '../api/index.ts';
import {
  buildSignRequest,
  type ConsentFormValues,
  consentResolver,
  fieldOfRule,
  initialValues,
  signerRuleOf,
} from './consent-form.ts';
import { contextOf, REFUSED_NAMES, SHA, TWO_EMAILS } from './test-support.ts';

// E18-S01: the values of the consent form, the check, the request it builds, and the reading of a refusal.

const GOOD: ConsentFormValues = { consent: true, name: 'Ada Lovelace', email: 'ada@example.org' };

/** What the resolver says of `values`, whatever the options of React Hook Form are (it reads none). */
async function resolved(values: ConsentFormValues): Promise<ResolverResult<ConsentFormValues>> {
  return consentResolver(values, undefined, { fields: {}, shouldUseNativeValidation: false });
}

test('values that pass are returned as they are, with no error', async () => {
  expect(await resolved(GOOD)).toEqual({ values: GOOD, errors: {} });
});

test.each([
  ['the consent', { ...GOOD, consent: false }, ['consent']],
  ['the name', { ...GOOD, name: '' }, ['name']],
  ['the address', { ...GOOD, email: '' }, ['email']],
  ['all three', { consent: false, name: '  ', email: '' }, ['consent', 'name', 'email']],
])('without %s the errors name exactly those fields, and no value is returned', async (_label, values, fields) => {
  const result = await resolved(values);
  expect(result.values).toEqual({});
  expect(Object.keys(result.errors)).toEqual(fields);
});

test.each(REFUSED_NAMES)('a name with %s is wrong, as it is for the server', async (_label, name) => {
  expect(Object.keys((await resolved({ ...GOOD, name })).errors)).toEqual(['name']);
});

test('a name of 201 code points that are each two UTF-16 units is wrong', async () => {
  expect(Object.keys((await resolved({ ...GOOD, name: '\u{1f600}'.repeat(201) })).errors)).toEqual(['name']);
});

test('a name of 200 code points that are each two UTF-16 units is right', async () => {
  expect((await resolved({ ...GOOD, name: '\u{1f600}'.repeat(200) })).errors).toEqual({});
});

test.each(HOSTILE_NAMES)('the hostile name %j is a name, as it is for the server', async (name) => {
  expect((await resolved({ ...GOOD, name })).errors).toEqual({});
});

test.each([
  ['no address', [], ''],
  ['one address', [{ email: 'ada@example.org', primary: true }], 'ada@example.org'],
  ['two addresses', TWO_EMAILS, ''],
])('the form starts with nothing agreed, no name, and the choice for %s', (_label, emails, chosen) => {
  expect(initialValues(contextOf({ emails }))).toEqual({ consent: false, name: '', email: chosen });
});

test('the request carries the identity of the text on screen and the cleaned name', () => {
  expect(buildSignRequest(contextOf(), { ...GOOD, name: '  Ada \u00a0 Lovelace  ' })).toStrictEqual({
    githubRepoId: 123,
    prNumber: 45,
    versionId: 31,
    contentSha256: SHA,
    consentTextId: 'individual-v1',
    name: 'Ada Lovelace',
    email: 'ada@example.org',
  });
});

test('the request has no pull request number when the link had none', () => {
  expect(buildSignRequest(contextOf({ pr: null, prUrl: null }), GOOD)).not.toHaveProperty('prNumber');
});

test('values that do not pass the check never make a request', () => {
  expect(() => buildSignRequest(contextOf(), { ...GOOD, consent: false })).toThrow();
});

test.each(Object.keys(SIGNER_RULE_STATUS))('the %s refusal is about the typed name or the address', (code) => {
  expect(signerRuleOf(new ApiError({ status: 422, code }))).toBe(code);
});

test.each([
  ['an error with another code', new ApiError({ status: 422, code: 'hash_mismatch' })],
  ['an error with an inherited name as its code', new ApiError({ status: 422, code: 'constructor' })],
  ['an error with an empty code', new ApiError({ status: 422, code: '' })],
  ['a contract error', new ContractError('POST /api/sign', 'response', [])],
  ['a plain error', new Error('invalid_name')],
  ['an object with the code', { code: 'invalid_name' }],
  ['nothing', undefined],
  ['a string', 'invalid_name'],
])('%s is not a refusal about the typed name or the address', (_label, error) => {
  expect(signerRuleOf(error)).toBeUndefined();
});

test.each([
  ['invalid_name', 'name'],
  ['email_not_verified', 'email'],
  ['no_verified_email', 'email'],
] as const)('the %s refusal is shown on the %s field', (rule, field) => {
  expect(fieldOfRule(rule)).toBe(field);
});
