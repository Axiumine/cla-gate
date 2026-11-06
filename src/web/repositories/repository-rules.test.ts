// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { ApiError } from '../api/index.ts';
import { isGone, REPOSITORY_RULES, repositoryRuleOf } from './repository-rules.ts';

// E18-S10: how an error of the attach, the enable and the disable is told to be one of the rules the screen has words for. A rule is told
// by the status and the code together.

const failure = (status: number, code: string) => new ApiError({ status, code, requestId: 'req-00000001' });

test('the rules with words of their own are the four of the API', () => {
  expect(REPOSITORY_RULES).toEqual([
    'document_not_attachable',
    'document_unpublished',
    'repository_enabled',
    'no_active_cla',
  ]);
});

test.each([
  [422, 'document_not_attachable'],
  [409, 'document_unpublished'],
  [409, 'repository_enabled'],
  [409, 'no_active_cla'],
  [409, 'installation_suspended'],
])('%i %s is the rule of that name', (status, code) => {
  expect(repositoryRuleOf(failure(status, code))).toBe(code);
});

test.each([
  ['a rule with the status of another', failure(409, 'document_not_attachable')],
  ['the suspended code with another status', failure(422, 'installation_suspended')],
  ['a forbidden answer, which the error state tells', failure(403, 'forbidden')],
  ['a code nobody knows', failure(409, 'something_new')],
  ["an error that is not the server's", new Error('document_unpublished')],
  ['text', 'no_active_cla'],
  ['nothing', undefined],
])('%s is no rule the screen tells', (_what, error) => {
  expect(repositoryRuleOf(error)).toBeUndefined();
});

test.each([
  ['a 404', failure(404, 'not_found'), true],
  ['a 403', failure(403, 'forbidden'), false],
  ['a 409', failure(409, 'no_active_cla'), false],
  ["an error that is not the server's", new Error('not_found'), false],
])('%s: the repository is gone: %s', (_what, error, gone) => {
  expect(isGone(error)).toBe(gone);
});
