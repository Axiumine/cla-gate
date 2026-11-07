// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { pathParamNames } from './contract.ts';
import { erasurePreviewRoute, erasuresRoute } from './erasure-routes.ts';

// E18-S14: the descriptors of the erasure of a signer's personal data that the signatures screen calls by. Each one is the method and the
// path the server registers, with the success status it answers, and the parameters of its path.

test.each([
  [erasurePreviewRoute, 'GET /api/installations/:installationId/erasure-preview'],
  [erasuresRoute, 'POST /api/installations/:installationId/erasures'],
])('%#: %o is the route %s, answered with 200, addressed through the installation', (route, name) => {
  expect(route.name).toBe(name);
  expect(Object.keys(route.responses)).toEqual(['200']);
  expect(pathParamNames(route.path)).toEqual(['installationId']);
});

test.each([
  ['a numeric GitHub id', { githubUserId: 4711 }, true],
  ['an id of 0', { githubUserId: 0 }, false],
  ['a login instead of an id', { githubUserId: 'octocat' }, false],
  ['no id', {}, false],
  ['a key nobody defined', { githubUserId: 4711, login: 'octocat' }, false],
])('the preview takes %s: %o is valid: %s', (_what, query, valid) => {
  expect(erasurePreviewRoute.query.safeParse(query).success).toBe(valid);
});

test.each([
  ['the person by id and the rows seen', { githubUserId: 4711, expectedRows: 2 }, true],
  ['zero rows seen, which is a count like another', { githubUserId: 4711, expectedRows: 0 }, true],
  ['a negative count', { githubUserId: 4711, expectedRows: -1 }, false],
  ['a login beside the id', { githubUserId: 4711, expectedRows: 2, login: 'octocat' }, false],
])('the erasure takes %s: %o is valid: %s', (_what, body, valid) => {
  expect(erasuresRoute.body.safeParse(body).success).toBe(valid);
});

test('the preview answers with counts and the id only, and the erasure with how many rows it removed', () => {
  const counts = { githubUserId: 4711, signatures: 2, signerPiiRows: 2, allowlistEntries: 1, corporateApprovals: 3 };
  expect(erasurePreviewRoute.responses[200].safeParse(counts).success).toBe(true);
  expect(erasurePreviewRoute.responses[200].safeParse({ ...counts, corporateApprovals: undefined }).success).toBe(
    false,
  );
  expect(erasuresRoute.responses[200].safeParse({ erasedRows: 2 }).success).toBe(true);
  expect(erasuresRoute.responses[200].safeParse({ erasedRows: -1 }).success).toBe(false);
});
