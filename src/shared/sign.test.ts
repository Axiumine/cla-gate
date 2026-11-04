// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  currentVersionSchema,
  SIGN_PATH,
  SIGN_REFUSAL_STATUS,
  type SignRequest,
  signedSignatureSchema,
  signRequestSchema,
  signResponseSchema,
  signRoute,
} from './sign.ts';

// E13-S04: the contract of the sign request. The example below is the body of the story.

const EXAMPLE = {
  githubRepoId: 123,
  prNumber: 45,
  versionId: 31,
  contentSha256: 'a'.repeat(64),
  consentTextId: 'individual-v1',
  name: 'Ada Lovelace',
  email: 'ada@example.org',
} satisfies SignRequest;

test('the route is POST /api/sign with the schema of the body and one answer for 200 and 201', () => {
  expect(signRoute.name).toBe('POST /api/sign');
  expect(SIGN_PATH).toBe('/api/sign');
  expect(signRoute.body).toBe(signRequestSchema);
  expect(signRoute.responses[200]).toBe(signResponseSchema);
  expect(signRoute.responses[201]).toBe(signResponseSchema);
});

test('the example of the story is a valid request, and the pull request number is optional', () => {
  expect(signRequestSchema.parse(EXAMPLE)).toEqual(EXAMPLE);
  const withoutPr = Object.fromEntries(Object.entries(EXAMPLE).filter(([key]) => key !== 'prNumber'));
  expect(signRequestSchema.parse(withoutPr)).toEqual(withoutPr);
});

test.each([
  ['a key the schema does not know', { ...EXAMPLE, extra: 1 }],
  ['a person named in the body', { ...EXAMPLE, githubId: 7 }],
  ['no repository id', { ...EXAMPLE, githubRepoId: undefined }],
  ['a repository id of zero', { ...EXAMPLE, githubRepoId: 0 }],
  ['a version id with a decimal', { ...EXAMPLE, versionId: 31.5 }],
  ['a hash in capitals', { ...EXAMPLE, contentSha256: 'A'.repeat(64) }],
  ['a hash of 65 characters', { ...EXAMPLE, contentSha256: 'a'.repeat(65) }],
  ['an empty consent id', { ...EXAMPLE, consentTextId: '' }],
  ['a consent id of 65 characters', { ...EXAMPLE, consentTextId: 'c'.repeat(65) }],
  ['a pull request number of zero', { ...EXAMPLE, prNumber: 0 }],
  ['a pull request number of 2147483648', { ...EXAMPLE, prNumber: 2_147_483_648 }],
  ['a name that is a number', { ...EXAMPLE, name: 5 }],
  ['an address that is a number', { ...EXAMPLE, email: 5 }],
])('a request with %s is not valid', (_label, body) => {
  expect(signRequestSchema.safeParse(body).success).toBe(false);
});

test.each([
  ['a consent id of 64 characters', { consentTextId: 'c'.repeat(64) }],
  ['the largest pull request number', { prNumber: 2_147_483_647 }],
  ['a name the cleaning of the form would refuse', { name: 'Ada\u0007' }],
  ['an empty name', { name: '' }],
  ['an empty address', { email: '' }],
])(
  'a request with %s is valid here: the rules of the name and the address answer with their own codes',
  (_label, change) => {
    expect(signRequestSchema.safeParse({ ...EXAMPLE, ...change }).success).toBe(true);
  },
);

test('the answer names the signature and whether it was created, and nothing else', () => {
  const answer = {
    signature: { id: 5, versionId: 31, major: 2, minor: 0, signedAt: '2026-11-01T10:00:00.000Z' },
    created: true,
  };
  expect(signResponseSchema.parse(answer)).toEqual(answer);
  expect(signResponseSchema.safeParse({ ...answer, name: 'Ada' }).success).toBe(false);
  expect(signedSignatureSchema.safeParse({ ...answer.signature, email: 'ada@example.org' }).success).toBe(false);
  expect(signedSignatureSchema.safeParse({ ...answer.signature, signedAt: 'yesterday' }).success).toBe(false);
});

test('the rules after the repository was found have the statuses of the story, spelled out here on purpose', () => {
  expect(SIGN_REFUSAL_STATUS).toEqual({
    stale_version: 409,
    hash_mismatch: 422,
    stale_consent: 409,
    unsupported_document_kind: 409,
  });
});

test('the version in force that a stale version carries is the id, the numbers and the hash', () => {
  const current = { versionId: 31, major: 2, minor: 1, contentSha256: 'a'.repeat(64) };
  expect(currentVersionSchema.parse(current)).toEqual(current);
  expect(currentVersionSchema.safeParse({ ...current, contentMd: 'text' }).success).toBe(false);
});
