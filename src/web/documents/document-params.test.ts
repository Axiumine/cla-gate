// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { documentRouteParams, parseDocumentId } from './document-params.ts';

// E18-S05: what the address of a document holds. Only the spelling the app writes is a document id.

test.each([
  ['7', 7],
  ['11', 11],
  ['9007199254740991', Number.MAX_SAFE_INTEGER],
])('%s is the document id %d', (raw, expected) => {
  expect(parseDocumentId(raw)).toBe(expected);
});

test.each([
  '',
  '0',
  '007',
  '-1',
  '+1',
  '1e3',
  '0x10',
  ' 5',
  '5 ',
  '5.0',
  '1.5',
  'abc',
  '９',
  '9007199254740992',
  '12345678901234567',
])('%j is not a document id', (raw) => {
  expect(parseDocumentId(raw)).toBeUndefined();
});

test('the route parses a plain id into a number and refuses anything else, and writes the number back as digits', () => {
  expect(documentRouteParams.parse({ documentId: '11' })).toEqual({ documentId: 11 });
  expect(documentRouteParams.parse({ documentId: '1e3' })).toBe(false);
  expect(documentRouteParams.stringify({ documentId: 11 })).toEqual({ documentId: '11' });
});
