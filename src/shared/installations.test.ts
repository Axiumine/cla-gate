// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  attachedDocumentSchema,
  INSTALLATION_REPOSITORIES_PATH,
  INSTALLATIONS_PATH,
  installationListRoute,
  installationListSchema,
  installationParamsSchema,
  installationRepositoriesRoute,
  installationSummarySchema,
  REPOSITORY_SEARCH_MAX_LENGTH,
  repositoryItemSchema,
  repositoryListQuerySchema,
  repositoryPageSchema,
} from './installations.ts';

test('the two paths are the ones the routes and the screens use, the installation of the second one by its row id', () => {
  expect(INSTALLATIONS_PATH).toBe('/api/installations');
  expect(INSTALLATION_REPOSITORIES_PATH).toBe('/api/installations/:installationId/repositories');
});

test('an empty query is valid and names nothing', () => {
  expect(repositoryListQuerySchema.parse({})).toEqual({});
});

test('a query with every parameter is read: the limit and the enabled flag as numbers and booleans, q and the cursor as they are', () => {
  expect(repositoryListQuerySchema.parse({ limit: '25', cursor: 'abc', q: 'Parser_%', enabled: 'false' })).toEqual({
    limit: 25,
    cursor: 'abc',
    q: 'Parser_%',
    enabled: false,
  });
  expect(repositoryListQuerySchema.parse({ enabled: 'true' }).enabled).toBe(true);
});

test.each([
  ['limit', '0'],
  ['limit', '101'],
  ['limit', 'ten'],
  ['limit', '07'],
  ['cursor', ''],
  ['q', ''],
  ['q', 'a'.repeat(REPOSITORY_SEARCH_MAX_LENGTH + 1)],
  ['q', 'a\0b'],
  ['q', 'a\uD800b'],
  ['enabled', 'yes'],
  ['enabled', 'TRUE'],
  ['enabled', ''],
])('%s=%j is refused', (name, value) => {
  expect(repositoryListQuerySchema.safeParse({ [name]: value }).success).toBe(false);
});

test('a q of exactly the longest length is accepted, and one with a character outside the first plane too', () => {
  expect(repositoryListQuerySchema.safeParse({ q: 'a'.repeat(REPOSITORY_SEARCH_MAX_LENGTH) }).success).toBe(true);
  expect(repositoryListQuerySchema.safeParse({ q: 'repo-\u{1F600}' }).success).toBe(true);
});

test('a parameter the list does not know is refused, not ignored', () => {
  expect(repositoryListQuerySchema.safeParse({ sort: 'name' }).success).toBe(false);
  expect(repositoryListQuerySchema.safeParse({ installationId: '1' }).success).toBe(false);
});

const SUMMARY = {
  id: 1,
  accountLogin: 'acme',
  accountType: 'Organization',
  role: 'org_admin',
  suspended: false,
  repositoryCount: 3,
  enabledCount: 1,
  truncated: false,
} as const;

test('an installation summary has the eight fields and the roles org_admin and repo_admin only', () => {
  expect(installationSummarySchema.parse(SUMMARY)).toEqual(SUMMARY);
  expect(installationSummarySchema.parse({ ...SUMMARY, role: 'repo_admin' }).role).toBe('repo_admin');
  expect(installationSummarySchema.safeParse({ ...SUMMARY, role: 'contributor' }).success).toBe(false);
  expect(installationSummarySchema.safeParse({ ...SUMMARY, accountType: 'Bot' }).success).toBe(false);
  expect(installationSummarySchema.safeParse({ ...SUMMARY, repositoryCount: -1 }).success).toBe(false);
  expect(installationSummarySchema.safeParse({ ...SUMMARY, id: 0 }).success).toBe(false);
});

const ITEM = {
  id: 7,
  githubRepoId: 99,
  fullName: 'acme/api',
  enabled: true,
  canAdminister: false,
  document: { id: 3, name: 'Individual CLA', scope: 'repository', activeVersion: { major: 1, minor: 0 } },
} as const;

test('a repository item carries its document, or null, and the version the document has active, or null', () => {
  expect(repositoryItemSchema.parse(ITEM)).toEqual(ITEM);
  expect(repositoryItemSchema.parse({ ...ITEM, document: null }).document).toBeNull();
  expect(attachedDocumentSchema.parse({ ...ITEM.document, activeVersion: null }).activeVersion).toBeNull();
  expect(attachedDocumentSchema.safeParse({ ...ITEM.document, scope: 'organisation' }).success).toBe(false);
  expect(attachedDocumentSchema.safeParse({ ...ITEM.document, activeVersion: { major: 0, minor: 0 } }).success).toBe(
    false,
  );
  expect(repositoryItemSchema.safeParse({ ...ITEM, githubRepoId: 0 }).success).toBe(false);
});

test('a page has its items and a cursor that is text or null', () => {
  expect(repositoryPageSchema.parse({ items: [ITEM], nextCursor: 'abc' }).nextCursor).toBe('abc');
  expect(repositoryPageSchema.parse({ items: [], nextCursor: null }).nextCursor).toBeNull();
  expect(repositoryPageSchema.safeParse({ items: [] }).success).toBe(false);
});

test('the list of installations is a GET of its path, answered with the list schema, and takes no input', () => {
  expect(installationListRoute.name).toBe('GET /api/installations');
  expect(installationListRoute.method).toBe('GET');
  expect(installationListRoute.path).toBe(INSTALLATIONS_PATH);
  expect(installationListRoute.responses[200]).toBe(installationListSchema);
  expect('params' in installationListRoute).toBe(false);
  expect('query' in installationListRoute).toBe(false);
});

test('the list of repositories is a GET below an installation, with the id as its param and the repository query', () => {
  expect(installationRepositoriesRoute.name).toBe('GET /api/installations/:installationId/repositories');
  expect(installationRepositoriesRoute.path).toBe(INSTALLATION_REPOSITORIES_PATH);
  expect(installationRepositoriesRoute.params).toBe(installationParamsSchema);
  expect(installationRepositoriesRoute.query).toBe(repositoryListQuerySchema);
  expect(installationRepositoriesRoute.responses[200]).toBe(repositoryPageSchema);
});

test('the installation of a path is a positive whole number, by the row id', () => {
  expect(installationParamsSchema.parse({ installationId: 5 })).toEqual({ installationId: 5 });
  for (const installationId of [0, -1, 1.5, '5', Number.NaN, 2 ** 53]) {
    expect(installationParamsSchema.safeParse({ installationId }).success).toBe(false);
  }
});
