// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  addInstallationEntryRoute,
  addRepositoryEntryRoute,
  installationAllowlistRoute,
  removeEntryRoute,
  repositoryAllowlistRoute,
} from './allowlist-routes.ts';
import { pathParamNames } from './contract.ts';

// E18-S06: the descriptors of the allowlist API that the allowlist screen calls by. Each one is the method and the path the server
// registers, with the success status it answers, and the parameters of its path.

test.each([
  [installationAllowlistRoute, 'GET /api/installations/:installationId/allowlist-entries', 200, ['installationId']],
  [repositoryAllowlistRoute, 'GET /api/repositories/:repositoryId/allowlist-entries', 200, ['repositoryId']],
  [addInstallationEntryRoute, 'POST /api/installations/:installationId/allowlist-entries', 201, ['installationId']],
  [addRepositoryEntryRoute, 'POST /api/repositories/:repositoryId/allowlist-entries', 201, ['repositoryId']],
  [
    removeEntryRoute,
    'DELETE /api/installations/:installationId/allowlist-entries/:entryId',
    204,
    ['installationId', 'entryId'],
  ],
])('%#: %o is the route %s, answered with %i', (route, name, status, params) => {
  expect(route.name).toBe(name);
  expect(Object.keys(route.responses)).toEqual([String(status)]);
  expect(pathParamNames(route.path)).toEqual(params);
});

test('the lists take the page query and the adds take the body of an entry; the removal takes neither', () => {
  expect(installationAllowlistRoute.query.safeParse({ limit: '200', cursor: 'next' }).success).toBe(true);
  expect(repositoryAllowlistRoute.query.safeParse({ limit: '201' }).success).toBe(false);
  expect(addInstallationEntryRoute.body.safeParse({ kind: 'user', login: 'octocat' }).success).toBe(true);
  expect(addRepositoryEntryRoute.body.safeParse({ kind: 'org_members' }).success).toBe(true);
  expect(addRepositoryEntryRoute.body.safeParse({ kind: 'user' }).success).toBe(false);
  expect('body' in removeEntryRoute).toBe(false);
  expect('query' in removeEntryRoute).toBe(false);
});
