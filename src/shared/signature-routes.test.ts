// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { pathParamNames } from './contract.ts';
import { signatureRevokeRoute, signatureSearchRoute } from './signature-routes.ts';

// E18-S07: the descriptors of the signature API that the signatures screen calls by. Each one is the method and the path the server
// registers, with the success status it answers, and the parameters of its path.

test.each([
  [signatureSearchRoute, 'GET /api/installations/:installationId/signatures', ['installationId']],
  [
    signatureRevokeRoute,
    'POST /api/installations/:installationId/signatures/:signatureId/revoke',
    ['installationId', 'signatureId'],
  ],
])('%#: %o is the route %s, answered with 200', (route, name, params) => {
  expect(route.name).toBe(name);
  expect(Object.keys(route.responses)).toEqual(['200']);
  expect(pathParamNames(route.path)).toEqual(params);
});

test.each([
  ['the two exact ways to find a signer', { githubUserId: 4711, login: 'octocat' }, true],
  ['a state, a document, a page and a cursor', { state: 'outdated', documentId: 3, limit: 50, cursor: 'next' }, true],
  ['a state the export does not know', { state: 'expired' }, false],
  ['a login of 101 characters', { login: 'a'.repeat(101) }, false],
  ['an id that is not positive', { githubUserId: 0 }, false],
  ['a limit above 100', { limit: 101 }, false],
  ['a key nobody defined', { q: 'octocat' }, false],
])('the search query takes %s: %o is valid: %s', (_what, query, valid) => {
  expect(signatureSearchRoute.query.safeParse(query).success).toBe(valid);
});

test('the revocation takes a reason code and nothing else, and answers with the signature as it is now', () => {
  expect(signatureRevokeRoute.body.safeParse({ reasonCode: 'legal_request' }).success).toBe(true);
  expect(signatureRevokeRoute.body.safeParse({ reasonCode: 'because' }).success).toBe(false);
  expect(signatureRevokeRoute.body.safeParse({ reasonCode: 'other', note: 'free text' }).success).toBe(false);
  expect('query' in signatureRevokeRoute).toBe(false);
});
