// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  revokeReasonSchema,
  SIGNATURE_REVOKE_PATH,
  signatureRevokeRequestSchema,
  signatureRevokeResponseSchema,
} from './signature-revoke.ts';

// E15-S03: the contract of revoking a signature. The reason is one of the four codes of the database check, never free text.

test('the route is POST /api/installations/:installationId/signatures/:signatureId/revoke', () => {
  expect(SIGNATURE_REVOKE_PATH).toBe('/api/installations/:installationId/signatures/:signatureId/revoke');
});

test.each(['signer_request', 'maintainer_decision', 'legal_request', 'other'])('the reason %s is accepted', (code) => {
  expect(revokeReasonSchema.safeParse(code).success).toBe(true);
  expect(signatureRevokeRequestSchema.safeParse({ reasonCode: code }).success).toBe(true);
});

test.each([
  ['free text', { reasonCode: 'the signer asked me by mail' }],
  ['a code of another case', { reasonCode: 'OTHER' }],
  ['an empty code', { reasonCode: '' }],
  ['a number', { reasonCode: 1 }],
  ['no reason', {}],
  ['a key nobody defined', { reasonCode: 'other', note: 'x' }],
  ['no body', undefined],
  ['a list', ['other']],
])('a body with %s is refused', (_label, body) => {
  expect(signatureRevokeRequestSchema.safeParse(body).success).toBe(false);
});

test('the answer holds the signature as revoked, its instant in UTC, and the number of jobs; any other state or key is refused', () => {
  const answer = { signature: { id: 31, state: 'revoked', revokedAt: '2026-11-04T10:00:00.123Z' }, reevaluating: 2 };
  expect(signatureRevokeResponseSchema.parse(answer)).toEqual(answer);
  expect(signatureRevokeResponseSchema.safeParse({ ...answer, reevaluating: 0 }).success).toBe(true);
  expect(signatureRevokeResponseSchema.safeParse({ ...answer, reevaluating: -1 }).success).toBe(false);
  expect(signatureRevokeResponseSchema.safeParse({ ...answer, extra: 1 }).success).toBe(false);
  expect(
    signatureRevokeResponseSchema.safeParse({ ...answer, signature: { ...answer.signature, state: 'active' } }).success,
  ).toBe(false);
  expect(
    signatureRevokeResponseSchema.safeParse({
      ...answer,
      signature: { ...answer.signature, revokedAt: '2026-11-04T10:00:00+01:00' },
    }).success,
  ).toBe(false);
});
