// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { resignPath } from './resign-path.ts';

// The way back to the sign page (E13-S06): the source repository first, then the lowest repository of the document, then none;
// and nothing at all for a signature that still covers the person.

const BOTH = { source: 500, document: 100 };
const DOCUMENT_ONLY = { source: null, document: 100 };
const SOURCE_ONLY = { source: 500, document: null };
const NEITHER = { source: null, document: null };

test.each([
  ['outdated, the source repository is there', 'outdated', BOTH, '/sign/500'],
  ['revoked, the source repository is there', 'revoked', BOTH, '/sign/500'],
  ['outdated, the source is gone and the document has a repository', 'outdated', DOCUMENT_ONLY, '/sign/100'],
  ['revoked, the source is gone and the document has a repository', 'revoked', DOCUMENT_ONLY, '/sign/100'],
  ['outdated, the source is the only repository', 'outdated', SOURCE_ONLY, '/sign/500'],
  ['outdated, no repository at all', 'outdated', NEITHER, null],
  ['revoked, no repository at all', 'revoked', NEITHER, null],
  ['active, the source repository is there', 'active', BOTH, null],
  ['active, only the document has a repository', 'active', DOCUMENT_ONLY, null],
  ['active, no repository at all', 'active', NEITHER, null],
] as const)('%s', (_name, state, repositories, path) => {
  expect(resignPath(state, repositories)).toBe(path);
});
