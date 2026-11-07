// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { SWEEP_REPOSITORY_REASONS, sweepRepositoryCoalesceKey } from './repository-jobs.ts';

// The rules of the repository-level jobs (E07-S09): the closed set of reasons and the coalesce key.

test('the reasons are the seven of E07-S09 in the order the story names them, then the two of E21 (S04 and S05)', () => {
  expect(SWEEP_REPOSITORY_REASONS).toEqual([
    'repository_enabled',
    'cla_version_published',
    'cla_document_changed',
    'allowlist_changed',
    'signature_revoked',
    'signatures_invalidated',
    'override_changed',
    'corporate_claim',
    'corporate_approval_revoked',
  ]);
});

test('a sweep-repository is coalesced per repository, and the key does not depend on the reason or the installation', () => {
  expect(sweepRepositoryCoalesceKey(parseGithubId(9000))).toBe('sweep-repository:9000');
  expect(sweepRepositoryCoalesceKey(parseGithubId(9001))).toBe('sweep-repository:9001');
});
