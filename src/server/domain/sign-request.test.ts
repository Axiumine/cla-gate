// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { judgeSignRequest, type ShownToSigner, type VersionInForce } from './sign-request.ts';

// E13-S04: whether a sign request is about the version in force. Pure, so every rule and every pair of rules is shown with plain values.

const HASH = 'a'.repeat(64);
const OTHER_HASH = 'b'.repeat(64);

const IN_FORCE: VersionInForce = { versionId: 31, major: 2, minor: 1, contentSha256: HASH, documentKind: 'individual' };

const SHOWN: ShownToSigner = { versionId: 31, contentSha256: HASH, consentTextId: 'individual-v1' };

const STALE = {
  rule: 'stale_version',
  current: { versionId: 31, major: 2, minor: 1, contentSha256: HASH },
} as const;

test('a request for the version in force, with its hash and the consent sentence of today, for an individual CLA, breaks no rule', () => {
  expect(judgeSignRequest(SHOWN, IN_FORCE)).toBeNull();
});

test('another version is stale_version and carries the id, numbers and hash of the version in force, and nothing else of it', () => {
  expect(judgeSignRequest({ ...SHOWN, versionId: 30 }, IN_FORCE)).toEqual(STALE);
  expect(Object.keys(STALE.current)).toEqual(['versionId', 'major', 'minor', 'contentSha256']);
  expect(judgeSignRequest({ ...SHOWN, versionId: 32 }, { ...IN_FORCE, documentKind: 'corporate' })).toEqual(STALE);
});

test('a hash that is not the hash of the version is hash_mismatch', () => {
  expect(judgeSignRequest({ ...SHOWN, contentSha256: OTHER_HASH }, IN_FORCE)).toEqual({ rule: 'hash_mismatch' });
});

test.each([
  ['an older sentence', 'individual-v0'],
  ['a sentence that was never issued', 'zzzz-v1'],
  ['an empty id', ''],
  ['a property of every object', '__proto__'],
])('%s as the consent sentence is stale_consent', (_label, consentTextId) => {
  expect(judgeSignRequest({ ...SHOWN, consentTextId }, IN_FORCE)).toEqual({ rule: 'stale_consent' });
});

test('a corporate document is unsupported_document_kind', () => {
  expect(judgeSignRequest(SHOWN, { ...IN_FORCE, documentKind: 'corporate' })).toEqual({
    rule: 'unsupported_document_kind',
  });
});

test.each([
  ['the version before the hash', { versionId: 30, contentSha256: OTHER_HASH, consentTextId: 'x' }, 'stale_version'],
  ['the hash before the sentence', { contentSha256: OTHER_HASH, consentTextId: 'x' }, 'hash_mismatch'],
  ['the sentence before the kind of the document', { consentTextId: 'x' }, 'stale_consent'],
])('%s', (_label, change, rule) => {
  expect(judgeSignRequest({ ...SHOWN, ...change }, { ...IN_FORCE, documentKind: 'corporate' })?.rule).toBe(rule);
});
