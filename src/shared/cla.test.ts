// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  CLA_DOCUMENT_KINDS,
  CLA_RULE_STATUS,
  CORPORATE_KIND_ENABLED,
  claDocumentDetailSchema,
  claDocumentSchema,
  createDocumentRequestSchema,
  DOCUMENT_PATH,
  DOCUMENTS_PATH,
  DRAFT_PATH,
  documentListResponseSchema,
  isKindSupported,
  MAX_DOCUMENTS_PER_INSTALLATION,
  PAGE_SIZE,
  pageQuerySchema,
  REPOSITORY_DOCUMENTS_PATH,
  renameDocumentRequestSchema,
  repositoryDocumentsResponseSchema,
} from './cla.ts';

const DOCUMENT = {
  id: 7,
  name: 'Individual CLA',
  kind: 'individual',
  scope: 'installation',
  repositoryId: null,
  activeVersion: null,
  createdAt: '2026-11-03T10:00:00.000Z',
  updatedAt: '2026-11-03T10:00:00.000Z',
} as const;

test('the paths are the ones the routes, the tests and the screens share', () => {
  expect(DOCUMENTS_PATH).toBe('/api/installations/:installationId/documents');
  expect(DOCUMENT_PATH).toBe('/api/installations/:installationId/documents/:documentId');
  expect(REPOSITORY_DOCUMENTS_PATH).toBe('/api/installations/:installationId/repositories/:repositoryId/documents');
  expect(DRAFT_PATH).toBe('/api/installations/:installationId/documents/:documentId/draft');
});

test('the schema accepts both kinds, and the corporate kind is off until E21 flips the constant', () => {
  expect(CLA_DOCUMENT_KINDS).toEqual(['individual', 'corporate']);
  expect(createDocumentRequestSchema.safeParse({ name: 'x', kind: 'corporate' }).success).toBe(true);
  expect(CORPORATE_KIND_ENABLED).toBe(false);
  expect(isKindSupported('individual')).toBe(true);
  expect(isKindSupported('corporate')).toBe(false);
});

test('a kind is supported when it is individual, or corporate while the corporate kind is on', () => {
  expect(isKindSupported('corporate', true)).toBe(true);
  expect(isKindSupported('corporate', false)).toBe(false);
  expect(isKindSupported('individual', false)).toBe(true);
});

test('the limits and the status of each rule are the ones the story names', () => {
  expect(MAX_DOCUMENTS_PER_INSTALLATION).toBe(100);
  expect(PAGE_SIZE).toEqual({ default: 50, max: 100 });
  expect(CLA_RULE_STATUS).toEqual({
    invalid_name: 422,
    kind_not_supported: 422,
    document_limit_reached: 422,
    document_name_taken: 409,
    content_too_large: 422,
    content_empty: 422,
    content_invalid_characters: 422,
    content_too_deeply_nested: 422,
    draft_conflict: 409,
    invalid_rationale: 422,
    first_version_must_be_major: 422,
    content_unchanged: 422,
    stale_active_version: 409,
    resign_confirmation_required: 409,
    version_conflict: 409,
    rollback_requires_major: 422,
    not_found: 404,
    document_not_attachable: 422,
    document_unpublished: 409,
    repository_enabled: 409,
    forbidden: 403,
    no_active_cla: 409,
  });
});

test.each([
  ['an installation-wide document', { name: 'x', kind: 'individual' }],
  ['a repository document', { name: 'x', kind: 'individual', repositoryId: 5 }],
  ['a corporate document', { name: 'x', kind: 'corporate' }],
  ['a name the service will refuse', { name: '', kind: 'individual' }],
])('a creation body of %s is accepted', (_label, body) => {
  expect(createDocumentRequestSchema.safeParse(body).success).toBe(true);
});

test.each([
  ['an unknown key', { name: 'x', kind: 'individual', extra: 1 }],
  ['no kind', { name: 'x' }],
  ['no name', { kind: 'individual' }],
  ['a null repository', { name: 'x', kind: 'individual', repositoryId: null }],
  ['repository 0', { name: 'x', kind: 'individual', repositoryId: 0 }],
  ['a repository as text', { name: 'x', kind: 'individual', repositoryId: '1' }],
  ['a repository beyond the safe integers', { name: 'x', kind: 'individual', repositoryId: 2 ** 60 }],
])('a creation body with %s is refused', (_label, body) => {
  expect(createDocumentRequestSchema.safeParse(body).success).toBe(false);
});

test('a rename body is the name alone', () => {
  expect(renameDocumentRequestSchema.safeParse({ name: 'x' }).success).toBe(true);
  expect(renameDocumentRequestSchema.safeParse({ name: 'x', kind: 'corporate' }).success).toBe(false);
  expect(renameDocumentRequestSchema.safeParse({}).success).toBe(false);
});

test.each([
  ['nothing', {}, {}],
  ['a limit', { limit: '25' }, { limit: 25 }],
  ['the largest limit', { limit: '100' }, { limit: 100 }],
  ['a cursor', { cursor: 'abc' }, { cursor: 'abc' }],
  ['both', { limit: '1', cursor: 'abc' }, { limit: 1, cursor: 'abc' }],
])('a list query of %s is read', (_label, query, read) => {
  expect(pageQuerySchema.parse(query)).toEqual(read);
});

test.each([
  ['limit 0', { limit: '0' }],
  ['limit 101', { limit: '101' }],
  ['a limit with a leading zero', { limit: '010' }],
  ['a limit with a sign', { limit: '+5' }],
  ['a limit as a number', { limit: 5 }],
  ['an empty cursor', { cursor: '' }],
  ['a cursor of 1025 characters', { cursor: 'a'.repeat(1025) }],
  ['an unknown key', { page: '2' }],
])('a list query with %s is refused', (_label, query) => {
  expect(pageQuerySchema.safeParse(query).success).toBe(false);
});

test('a document is parsed with its times as ISO 8601 and the detail adds the draft flag', () => {
  expect(claDocumentSchema.parse(DOCUMENT)).toEqual(DOCUMENT);
  expect(claDocumentDetailSchema.parse({ ...DOCUMENT, hasDraft: false })).toEqual({ ...DOCUMENT, hasDraft: false });
  expect(claDocumentDetailSchema.safeParse(DOCUMENT).success).toBe(false);
  expect(claDocumentSchema.safeParse({ ...DOCUMENT, createdAt: 'yesterday' }).success).toBe(false);
});

test('an active version carries the hash of the text as 64 lower-case hex digits and a time', () => {
  const version = { id: 1, major: 1, minor: 0, contentSha256: 'a'.repeat(64), publishedAt: DOCUMENT.createdAt };
  expect(claDocumentSchema.safeParse({ ...DOCUMENT, activeVersion: version }).success).toBe(true);
  for (const broken of [
    { ...version, contentSha256: 'A'.repeat(64) },
    { ...version, contentSha256: 'a'.repeat(63) },
    { ...version, major: 0 },
    { ...version, minor: -1 },
  ]) {
    expect(claDocumentSchema.safeParse({ ...DOCUMENT, activeVersion: broken }).success).toBe(false);
  }
});

test('a page of the list has a cursor or null, and the installation-wide entries of a repository carry no text, hash or time', () => {
  expect(documentListResponseSchema.parse({ documents: [DOCUMENT], nextCursor: null }).nextCursor).toBeNull();
  const entry = { id: 3, name: 'Individual CLA', activeVersion: { major: 2, minor: 1 } };
  const parsed = repositoryDocumentsResponseSchema.parse({
    repositoryScoped: [],
    installationScoped: [{ ...entry, contentSha256: 'a'.repeat(64), publishedAt: DOCUMENT.createdAt }],
  });
  expect(parsed.installationScoped).toEqual([entry]);
});
