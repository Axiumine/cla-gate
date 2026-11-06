// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { pathParamNames } from './contract.ts';
import {
  attachDocumentRoute,
  disableRepositoryRoute,
  enableRepositoryRoute,
  repositoryDocumentsRoute,
} from './repository-routes.ts';

// E18-S10: the descriptors of the repository actions that the Repositories screen calls by. Each one is the method and the path the
// server registers, with the success status it answers, and the parameters of its path.

test.each([
  [
    repositoryDocumentsRoute,
    'GET /api/installations/:installationId/repositories/:repositoryId/documents',
    ['installationId', 'repositoryId'],
  ],
  [attachDocumentRoute, 'PUT /api/repositories/:repositoryId/cla-document', ['repositoryId']],
  [enableRepositoryRoute, 'POST /api/repositories/:repositoryId/enable', ['repositoryId']],
  [disableRepositoryRoute, 'POST /api/repositories/:repositoryId/disable', ['repositoryId']],
])('%#: %o is the route %s, answered with 200', (route, name, params) => {
  expect(route.name).toBe(name);
  expect(Object.keys(route.responses)).toEqual(['200']);
  expect(pathParamNames(route.path)).toEqual(params);
});

test.each([
  ['a document to attach', { documentId: 7 }, true],
  ['null, which detaches', { documentId: null }, true],
  ['no document at all', {}, false],
  ['an id that is not positive', { documentId: 0 }, false],
  ['an id that is not whole', { documentId: 1.5 }, false],
  ['a key nobody defined (the installation, say)', { documentId: 7, installationId: 5 }, false],
])('the attach call takes %s: %o is valid: %s', (_what, body, valid) => {
  expect(attachDocumentRoute.body.safeParse(body).success).toBe(valid);
});

test('the enable and the disable call have neither a body nor a query', () => {
  expect('body' in enableRepositoryRoute).toBe(false);
  expect('query' in enableRepositoryRoute).toBe(false);
  expect('body' in disableRepositoryRoute).toBe(false);
  expect('query' in disableRepositoryRoute).toBe(false);
});

test('the answer of the enable and the disable call says whether the repository enforces now and whether the call changed it', () => {
  expect(enableRepositoryRoute.responses[200].parse({ enabled: true, changed: false })).toEqual({
    enabled: true,
    changed: false,
  });
  expect(disableRepositoryRoute.responses[200].safeParse({ enabled: true }).success).toBe(false);
});

test('the documents of a repository are its own and those of the installation that cover it', () => {
  const answer = repositoryDocumentsRoute.responses[200].parse({
    repositoryScoped: [],
    installationScoped: [{ id: 3, name: 'Org CLA', activeVersion: { major: 1, minor: 0 } }],
  });
  expect(answer.installationScoped[0]?.name).toBe('Org CLA');
  expect(repositoryDocumentsRoute.responses[200].safeParse({ repositoryScoped: [] }).success).toBe(false);
});
