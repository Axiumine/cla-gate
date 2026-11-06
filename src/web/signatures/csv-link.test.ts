// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { csvLinkOf } from './csv-link.ts';

// E18-S07: the address of the export carries the document and the status, and nothing else.

test.each([
  [5, 11, 'revoked', '/api/installations/5/documents/11/signatures.csv?state=revoked'],
  [5, 11, 'active', '/api/installations/5/documents/11/signatures.csv?state=active'],
  [5, 11, 'outdated', '/api/installations/5/documents/11/signatures.csv?state=outdated'],
  [5, 11, undefined, '/api/installations/5/documents/11/signatures.csv?state=all'],
  [6, 12, 'active', '/api/installations/6/documents/12/signatures.csv?state=active'],
] as const)('installation %i, document %i, status %s is %s', (installationId, documentId, state, address) => {
  expect(csvLinkOf(installationId, documentId, state)).toBe(address);
});

test('the ids are in the path in the order of the route, and the only query is the state', () => {
  const url = new URL(csvLinkOf(123, 456, 'active'), 'https://cla.example');
  expect(url.pathname).toBe('/api/installations/123/documents/456/signatures.csv');
  expect([...url.searchParams.keys()]).toEqual(['state']);
});
