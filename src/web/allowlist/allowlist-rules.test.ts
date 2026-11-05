// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { CLA_RULE_STATUS } from '../../shared/cla.ts';
import { ApiError, NetworkError } from '../api/index.ts';
import { messages } from '../i18n/index.ts';
import { ADD_RULES, type AddRule, addRuleOf, loginRuleOf } from './allowlist-rules.ts';

// E18-S06: how an error is told to be one of the rules of adding an entry: the status and the code of the error body together.

/** The status the API answers each rule with. */
const STATUS = new Map<string, number>(Object.entries(CLA_RULE_STATUS));

/** The error the client throws for `rule`, at the status the API answers it with. */
const ruleError = (rule: AddRule) => new ApiError({ status: Number(STATUS.get(rule)), code: rule });

test('the rules are the five of E14-S06 and each has its words in the catalog', () => {
  expect(ADD_RULES).toEqual([
    'github_account_not_found',
    'kind_mismatch',
    'allowlist_entry_exists',
    'no_organization',
    'members_permission_missing',
  ]);
  for (const rule of ADD_RULES) {
    expect(messages[`allowlist.rule.${rule}`]).toEqual(expect.any(String));
  }
});

test.each(ADD_RULES)('%s with the status the API answers it with is that rule', (rule) => {
  expect(addRuleOf(ruleError(rule))).toBe(rule);
});

test.each([
  ['the same code with another status', new ApiError({ status: 500, code: 'kind_mismatch' })],
  ['another rule of the API', new ApiError({ status: 409, code: 'document_name_taken' })],
  ['a code of no rule', new ApiError({ status: 422, code: 'something_new' })],
  ['a network failure', new NetworkError(new Error('offline'))],
  ['something that is not an error', 'kind_mismatch'],
  ['nothing', undefined],
])('%s is no rule of the add', (_what, error) => {
  expect(addRuleOf(error)).toBeUndefined();
  expect(loginRuleOf(error)).toBeUndefined();
});

test.each([
  ['github_account_not_found', 'github_account_not_found'],
  ['kind_mismatch', 'kind_mismatch'],
  ['allowlist_entry_exists', undefined],
  ['no_organization', undefined],
  ['members_permission_missing', undefined],
] as const)('%s belongs under the login field: %s', (rule, expected) => {
  expect(loginRuleOf(ruleError(rule))).toBe(expected);
});
