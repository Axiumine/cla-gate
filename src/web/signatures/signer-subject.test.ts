// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { createTranslator, messages } from '../i18n/index.ts';
import { signerSubject } from './signer-subject.ts';
import { erasedOf, signatureOf } from './test-support.ts';

// E18-S07: what a signature is called in a dialog and in the name of a button.

const t = createTranslator(messages, 'en');

test('a signature is called by the name the signer typed, not by the login or the id', () => {
  expect(signerSubject(signatureOf(), t)).toBe('Ada Lovelace');
});

test('a signature whose personal data was erased is called by the numeric GitHub id', () => {
  expect(signerSubject(erasedOf({ githubUserId: 9001 }), t)).toBe('GitHub user 9001');
});
