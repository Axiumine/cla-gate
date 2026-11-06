// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { pathParamNames } from './contract.ts';
import { invalidationPreviewRoute, invalidationsRoute } from './signature-invalidate-routes.ts';

// E18-S14: the descriptors of the invalidation of a major that the document screen calls by. Each one is the method and the path the server
// registers, with the success status it answers, and the parameters of its path.

test.each([
  [invalidationPreviewRoute, 'GET /api/installations/:installationId/documents/:documentId/invalidation-preview'],
  [invalidationsRoute, 'POST /api/installations/:installationId/documents/:documentId/invalidations'],
])('%#: %o is the route %s, answered with 200, addressed through the installation and the document', (route, name) => {
  expect(route.name).toBe(name);
  expect(Object.keys(route.responses)).toEqual(['200']);
  expect(pathParamNames(route.path)).toEqual(['installationId', 'documentId']);
});

test.each([
  ['a major', { major: 2 }, true],
  ['the largest major the column holds', { major: 2_147_483_647 }, true],
  ['major 0, which has never existed', { major: 0 }, false],
  ['a major above what the column holds', { major: 2_147_483_648 }, false],
  ['no major', {}, false],
  ['a key nobody defined', { major: 2, documentId: 3 }, false],
])('the preview takes %s: %o is valid: %s', (_what, query, valid) => {
  expect(invalidationPreviewRoute.query.safeParse(query).success).toBe(valid);
});

test.each([
  ['the major, a reason code and the count seen', { major: 2, reasonCode: 'legal_request', expectedCount: 7 }, true],
  ['a count of 0, which has nothing to confirm', { major: 2, reasonCode: 'other', expectedCount: 0 }, false],
  ['a reason that is not a code', { major: 2, reasonCode: 'because', expectedCount: 7 }, false],
  ['free text beside the code', { major: 2, reasonCode: 'other', expectedCount: 7, note: 'x' }, false],
  ['no count', { major: 2, reasonCode: 'other' }, false],
])('the invalidation takes %s: %o is valid: %s', (_what, body, valid) => {
  expect(invalidationsRoute.body.safeParse(body).success).toBe(valid);
});

test('the preview answers with counts only, and the invalidation with how many signatures it took out of force', () => {
  expect(
    invalidationPreviewRoute.responses[200].safeParse({ major: 2, activeSignatures: 7, affectedRepositories: 3 })
      .success,
  ).toBe(true);
  expect(
    invalidationPreviewRoute.responses[200].safeParse({
      major: 2,
      activeSignatures: 7,
      affectedRepositories: 3,
      signers: ['octocat'],
    }).success,
  ).toBe(false);
  expect(invalidationsRoute.responses[200].safeParse({ invalidated: 7 }).success).toBe(true);
  expect(invalidationsRoute.responses[200].safeParse({ invalidated: 0 }).success).toBe(false);
});
