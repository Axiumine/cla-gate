// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { ApiError, NetworkError } from '../api/index.ts';
import { messages } from '../i18n/index.ts';
import { OVERRIDE_RULES, overrideRuleOf } from './override-rules.ts';

// E18-S08: which refusals of a record or a removal the dialog tells in words of its own. A rule is the status and the code together.

const failure = (status: number, code: string) => new ApiError({ status, code, requestId: 'req-00000001' });

test('the rules of the dialog are the three about the commit and the repository', () => {
  expect(OVERRIDE_RULES).toEqual(['commit_not_found', 'override_exists', 'repository_disabled']);
});

test.each([
  ['commit_not_found', 422],
  ['override_exists', 409],
  ['repository_disabled', 409],
] as const)('the rule %s, answered with %d, is told, and has its words in the catalog', (rule, status) => {
  expect(overrideRuleOf(failure(status, rule))).toBe(rule);
  expect(Object.keys(messages)).toContain(`pending.rule.${rule}`);
});

test('the suspended installation, 409 with the code of the tenant guard, is told and has its words', () => {
  expect(overrideRuleOf(failure(409, 'installation_suspended'))).toBe('installation_suspended');
  expect(messages['pending.rule.installation_suspended']).toBeTruthy();
});

test.each([
  ['the code of a 422 rule with a 409', failure(409, 'commit_not_found')],
  ['the code of a 409 rule with a 422', failure(422, 'override_exists')],
  ['a suspended code with another status', failure(422, 'installation_suspended')],
  ['a field rule, which the form shows under its field', failure(422, 'invalid_reason')],
  ['a code of the status', failure(409, 'conflict')],
  ['a network failure', new NetworkError(new TypeError('offline'))],
  ['a plain error', new Error('commit_not_found')],
  ['nothing', undefined],
])('%s is no rule of the dialog', (_what, error) => {
  expect(overrideRuleOf(error)).toBeUndefined();
});
