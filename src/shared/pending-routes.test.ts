// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { pathParamNames } from './contract.ts';
import { listOverridesRoute, pendingPrsRoute, recordOverrideRoute, removeOverrideRoute } from './pending-routes.ts';

// E18-S08: the descriptors of the pending-list and override API that the pending screen calls by. Each one is the method and the path
// the server registers, with the success status it answers, and the parameters of its path.

test.each([
  [pendingPrsRoute, 'GET /api/installations/:installationId/pending-prs', '200', ['installationId']],
  [recordOverrideRoute, 'POST /api/repositories/:repositoryId/commit-overrides', '201', ['repositoryId']],
  [listOverridesRoute, 'GET /api/repositories/:repositoryId/commit-overrides', '200', ['repositoryId']],
  [
    removeOverrideRoute,
    'DELETE /api/repositories/:repositoryId/commit-overrides/:overrideId',
    '204',
    ['repositoryId', 'overrideId'],
  ],
])('%#: %o is the route %s, answered with %s', (route, name, status, params) => {
  expect(route.name).toBe(name);
  expect(Object.keys(route.responses)).toEqual([status]);
  expect(pathParamNames(route.path)).toEqual(params);
});

test.each([
  [
    'a repository, a reason, a page and a cursor',
    { repositoryId: 7, reason: 'unlinked_identity', limit: 50, cursor: 'c2' },
    true,
  ],
  ['every reason of the list, `other` too', { reason: 'other' }, true],
  ['a reason the list does not know', { reason: 'expired' }, false],
  ['a repository id that is not positive', { repositoryId: 0 }, false],
  ['a limit above 100', { limit: 101 }, false],
  ['an empty cursor', { cursor: '' }, false],
  ['a key nobody defined', { state: 'open' }, false],
])('the pending query takes %s: %o is valid: %s', (_what, query, valid) => {
  expect(pendingPrsRoute.query.safeParse(query).success).toBe(valid);
});

test('the list of overrides takes a page and a cursor and nothing else', () => {
  expect(listOverridesRoute.query.safeParse({ limit: 50, cursor: 'c2' }).success).toBe(true);
  expect(listOverridesRoute.query.safeParse({ repositoryId: 7 }).success).toBe(false);
});

const FULL_SHA = 'a'.repeat(40);

test.each([
  ['a full SHA-1 and a reason', { commitSha: FULL_SHA, reason: 'Bot commit' }, true],
  ['a full SHA-256', { commitSha: 'b'.repeat(64), reason: 'Bot commit' }, true],
  ['an abbreviated commit id', { commitSha: 'a'.repeat(7), reason: 'Bot commit' }, false],
  ['an upper-case commit id', { commitSha: 'A'.repeat(40), reason: 'Bot commit' }, false],
  ['a branch name', { commitSha: 'main', reason: 'Bot commit' }, false],
  ['a commit id with white space around it', { commitSha: ` ${FULL_SHA}`, reason: 'Bot commit' }, false],
  ['a key nobody defined (the installation, say)', { commitSha: FULL_SHA, reason: 'Bot', installationId: 5 }, false],
  ['no reason', { commitSha: FULL_SHA }, false],
])('the record takes %s: %o is valid: %s', (_what, body, valid) => {
  expect(recordOverrideRoute.body.safeParse(body).success).toBe(valid);
});

test('the removal has neither a body nor a query', () => {
  expect('body' in removeOverrideRoute).toBe(false);
  expect('query' in removeOverrideRoute).toBe(false);
});
