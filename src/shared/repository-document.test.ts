// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  REPOSITORY_CLA_DOCUMENT_PATH,
  repositoryDocumentRequestSchema,
  repositoryDocumentResponseSchema,
} from './repository-document.ts';

test('the path names the repository by its row id and no installation', () => {
  expect(REPOSITORY_CLA_DOCUMENT_PATH).toBe('/api/repositories/:repositoryId/cla-document');
});

test.each([
  ['a document to attach', { documentId: 7 }, { documentId: 7 }],
  ['null, which detaches', { documentId: null }, { documentId: null }],
])('a body with %s is read as it is', (_label, body, parsed) => {
  expect(repositoryDocumentRequestSchema.parse(body)).toEqual(parsed);
});

test.each([
  ['no key', {}],
  ['an undefined id', { documentId: undefined }],
  ['a text id', { documentId: '7' }],
  ['a zero id', { documentId: 0 }],
  ['a negative id', { documentId: -1 }],
  ['a fractional id', { documentId: 1.5 }],
  ['an unsafe id', { documentId: 2 ** 60 }],
  ['another key next to the id', { documentId: 7, installationId: 1 }],
])('a body with %s is refused', (_label, body) => {
  expect(repositoryDocumentRequestSchema.safeParse(body).success).toBe(false);
});

test('the answer is the document the repository enforces now and whether the call changed it', () => {
  expect(repositoryDocumentResponseSchema.parse({ documentId: 7, changed: true })).toEqual({
    documentId: 7,
    changed: true,
  });
  expect(repositoryDocumentResponseSchema.parse({ documentId: null, changed: false })).toEqual({
    documentId: null,
    changed: false,
  });
  expect(repositoryDocumentResponseSchema.safeParse({ documentId: 7 }).success).toBe(false);
});
