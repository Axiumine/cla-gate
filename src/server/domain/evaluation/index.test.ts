// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import * as evaluation from './index.ts';
import * as vocabulary from './types.ts';

test('the engine exposes exactly its vocabulary so far, and nothing it did not mean to', () => {
  expect(Object.keys(evaluation).sort((a, b) => a.localeCompare(b))).toEqual([
    'ACCOUNT_TYPES',
    'addCoAuthors',
    'ADVISORY_CODES',
    'ALLOWLIST_KINDS',
    'ALLOWLIST_SCOPES',
    'assessCoverage',
    'assessUnlinked',
    'classifyAccount',
    'extractActors',
    'FAILURE_CODES',
    'FIX_CODES',
    'GITHUB_WEB_FLOW_ID',
    'IGNORED_TRAILER_IDENTITIES',
    'isMergeCommit',
    'matchAllowlist',
    'MAX_TRAILERS_PER_COMMIT',
    'parseCoAuthors',
    'ROLES',
    'storedUnlinked',
  ]);
});

test('the public surface is the vocabulary itself, not a copy', () => {
  expect(evaluation.FAILURE_CODES).toBe(vocabulary.FAILURE_CODES);
  expect(evaluation.FIX_CODES).toBe(vocabulary.FIX_CODES);
});
