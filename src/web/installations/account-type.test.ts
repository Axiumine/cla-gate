// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { installationSummarySchema } from '../../shared/installations.ts';
import { messages } from '../i18n/index.ts';
import { accountTypeKey } from './account-type.ts';

// E18-S04: every account type of the contract has words in the catalog.

const TYPES = installationSummarySchema.shape.accountType.options;

test.each([
  ['Organization', 'Organisation'],
  ['User', 'Personal account'],
  ['Other', 'Other'],
] as const)('the account type %s is called %s', (accountType, words) => {
  expect(messages[accountTypeKey(accountType)]).toBe(words);
});

test('the table covers every account type of the contract, so a new one cannot be left without words', () => {
  expect(TYPES.map((type) => messages[accountTypeKey(type)])).toEqual(['Organisation', 'Personal account', 'Other']);
});
