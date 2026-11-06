// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { messages } from '../i18n/index.ts';
import { admissionReasonKey } from './admission-reason.ts';

// E18-S13: each stored reason of a rejection has a sentence of its own in the catalog, and none stored has one too.

test.each([
  ['account_not_allowed', 'operator.admission.reason.account_not_allowed'],
  ['policy_changed', 'operator.admission.reason.policy_changed'],
  [null, 'operator.admission.reason.none'],
] as const)('the reason %s is told by %s', (reason, key) => {
  expect(admissionReasonKey(reason)).toBe(key);
});

test('the three sentences are different, so a reason is never read as another', () => {
  const sentences = (['account_not_allowed', 'policy_changed', null] as const).map(
    (reason) => messages[admissionReasonKey(reason)],
  );
  expect(new Set(sentences).size).toBe(3);
});
