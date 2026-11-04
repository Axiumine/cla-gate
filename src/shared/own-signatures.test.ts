// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  OWN_SIGNATURE_STATES,
  OWN_SIGNATURES_PATH,
  ownSignatureSchema,
  ownSignaturesPageSchema,
  ownSignaturesRoute,
} from './own-signatures.ts';

// E13-S06: the contract of the list of a person's own signatures. The item below is one of the story's kind: an outdated signature
// of an org, with the pull request it was signed for and the way to sign again.

const ITEM = {
  id: 12,
  installation: { accountLogin: 'acme', accountType: 'Organization', suspended: false },
  document: { id: 7, name: 'Individual CLA' },
  version: { id: 31, major: 1, minor: 2 },
  signedAt: '2026-11-01T10:00:00.000Z',
  source: { repositoryFullName: 'acme/widgets', prNumber: 45 },
  state: 'outdated',
  revokedAt: null,
  resignPath: '/sign/123',
};

const REVOKED = { ...ITEM, state: 'revoked', revokedAt: '2026-11-02T10:00:00.000Z' };

test('the route is GET /api/me/signatures, with no parameter in the path and the page as its answer', () => {
  expect(ownSignaturesRoute.name).toBe('GET /api/me/signatures');
  expect(OWN_SIGNATURES_PATH).toBe('/api/me/signatures');
  expect(ownSignaturesRoute.responses[200]).toBe(ownSignaturesPageSchema);
  expect('params' in ownSignaturesRoute).toBe(false);
});

test('the three states are the words of the story, in the order of the function that decides them', () => {
  expect(OWN_SIGNATURE_STATES).toEqual(['active', 'outdated', 'revoked']);
});

test('the example is a valid item, and a page holds items and a cursor, or none', () => {
  expect(ownSignatureSchema.parse(ITEM)).toEqual(ITEM);
  expect(ownSignaturesPageSchema.parse({ items: [ITEM, REVOKED], nextCursor: 'abc' }).items).toHaveLength(2);
  expect(ownSignaturesPageSchema.parse({ items: [], nextCursor: null })).toEqual({ items: [], nextCursor: null });
});

test.each([
  ['no key at all', {}, true],
  ['a limit of 1', { limit: 1 }, true],
  ['a limit of 100', { limit: 100 }, true],
  ['a limit and a cursor', { limit: 50, cursor: 'abc' }, true],
  ['a limit of 0', { limit: 0 }, false],
  ['a limit of 101', { limit: 101 }, false],
  ['a decimal limit', { limit: 1.5 }, false],
  ['a limit as text', { limit: '5' }, false],
  ['an empty cursor', { cursor: '' }, false],
  ['a cursor beyond 1024 characters', { cursor: 'a'.repeat(1025) }, false],
  ['a cursor of 1024 characters', { cursor: 'a'.repeat(1024) }, true],
  ['a user id', { userId: 2 }, false],
  ['a GitHub id', { githubId: 2 }, false],
])('the query string: %s', (_what, query, valid) => {
  expect(ownSignaturesRoute.query.safeParse(query).success).toBe(valid);
});

test.each([
  ['an item with a key of the personal data', { ...ITEM, name: 'Ada' }],
  ['an item with a revocation reason', { ...REVOKED, revokeReason: 'other' }],
  ['an item with the person who revoked', { ...REVOKED, revokedBy: 3 }],
  ['an installation with a key it does not know', { ...ITEM, installation: { ...ITEM.installation, id: 1 } }],
  ['an unknown state', { ...ITEM, state: 'expired' }],
  ['an unknown account type', { ...ITEM, installation: { ...ITEM.installation, accountType: 'Bot' } }],
  ['a revoked item with no revocation instant', { ...REVOKED, revokedAt: null }],
  ['an instant on an item that is not revoked', { ...ITEM, revokedAt: '2026-11-02T10:00:00.000Z' }],
  ['a way to sign again on an active item', { ...ITEM, state: 'active', resignPath: '/sign/123' }],
  ['a way that is not the sign page', { ...ITEM, resignPath: '/sign/0' }],
  ['a way with a query string', { ...ITEM, resignPath: '/sign/123?pr=1' }],
  ['a way to another origin', { ...ITEM, resignPath: 'https://example.org/sign/123' }],
  ['an instant with an offset', { ...ITEM, signedAt: '2026-11-01T10:00:00+01:00' }],
  ['a pull request number of 0', { ...ITEM, source: { repositoryFullName: 'acme/widgets', prNumber: 0 } }],
])('%s is not an item', (_what, item) => {
  expect(ownSignatureSchema.safeParse(item).success).toBe(false);
});

test.each([
  ['an active item with no way to sign again', { ...ITEM, state: 'active', resignPath: null }],
  ['an outdated item with no repository to sign from', { ...ITEM, resignPath: null }],
  ['a signature with no source', { ...ITEM, source: null }],
  ['a signature made from the dashboard', { ...ITEM, source: { repositoryFullName: 'acme/widgets', prNumber: null } }],
  [
    'an installation of a person, suspended',
    { ...ITEM, installation: { ...ITEM.installation, accountType: 'User', suspended: true } },
  ],
])('%s is an item', (_what, item) => {
  expect(ownSignatureSchema.safeParse(item).success).toBe(true);
});
