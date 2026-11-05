// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { judgeCorporateRequest, readAgreementTexts } from './corporate-sign-request.ts';

// The rules of a corporate signing request that need no database (E21-S02): the version and the hash it names, and the texts.

const IN_FORCE = { versionId: 7, major: 2, minor: 1, contentSha256: 'a'.repeat(64) } as const;
const TEXTS = { companyName: ' Acme  GmbH ', signatoryTitle: ' CEO ', authorityConfirmed: true } as const;

test('a request for the version in force with its hash breaks no rule', () => {
  expect(judgeCorporateRequest({ versionId: 7, contentSha256: 'a'.repeat(64) }, IN_FORCE)).toBeNull();
});

test('another version is version_outdated and carries the version in force, whatever the hash', () => {
  const stale = judgeCorporateRequest({ versionId: 6, contentSha256: 'b'.repeat(64) }, IN_FORCE);
  expect(stale).toEqual({ rule: 'version_outdated', current: IN_FORCE });
  expect(stale?.rule === 'version_outdated' && stale.current).not.toBe(IN_FORCE);
});

test('the version in force with another hash is hash_mismatch and carries nothing', () => {
  expect(judgeCorporateRequest({ versionId: 7, contentSha256: 'b'.repeat(64) }, IN_FORCE)).toEqual({
    rule: 'hash_mismatch',
  });
});

test('the texts are cleaned', () => {
  expect(readAgreementTexts(TEXTS)).toEqual({ ok: true, companyName: 'Acme GmbH', signatoryTitle: 'CEO' });
});

test.each([
  ['the authority that is not confirmed', { ...TEXTS, authorityConfirmed: false }, 'authorityConfirmed'],
  ['a company name that is nothing', { ...TEXTS, companyName: '  ' }, 'companyName'],
  ['a title with a control character', { ...TEXTS, signatoryTitle: 'a\u0000b' }, 'signatoryTitle'],
  [
    'the authority before the texts',
    { companyName: '', signatoryTitle: '', authorityConfirmed: false },
    'authorityConfirmed',
  ],
  ['the company before the title', { companyName: '', signatoryTitle: '', authorityConfirmed: true }, 'companyName'],
])('%s names the field that fails', (_label, typed, field) => {
  expect(readAgreementTexts(typed)).toEqual({ ok: false, field });
});
