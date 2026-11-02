// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import {
  POLICY_CHANGE_WINDOW_SECONDS,
  policyChangeDedupeKey,
  SWEEP_REPOSITORY_REASONS,
  SWEEP_REPOSITORY_WINDOW_SECONDS,
  sweepRepositoryDedupeKey,
} from './repository-jobs.ts';

// The rules of the repository-level jobs (E07-S09): the closed set of reasons, the windows and the dedupe keys.

test('the reasons are the seven of the story, in the order the story names them', () => {
  expect(SWEEP_REPOSITORY_REASONS).toEqual([
    'repository_enabled',
    'cla_version_published',
    'cla_document_changed',
    'allowlist_changed',
    'signature_revoked',
    'signatures_invalidated',
    'override_changed',
  ]);
});

test('both windows are 60 seconds', () => {
  expect(SWEEP_REPOSITORY_WINDOW_SECONDS).toBe(60);
  expect(POLICY_CHANGE_WINDOW_SECONDS).toBe(60);
});

test('a sweep-repository is deduplicated per repository, and the key does not depend on the reason or the installation', () => {
  expect(sweepRepositoryDedupeKey(parseGithubId(9000))).toBe('sweep-repository:9000');
  expect(sweepRepositoryDedupeKey(parseGithubId(9001))).toBe('sweep-repository:9001');
});

test('an evaluation of a policy change is deduplicated per repository and pull request: the digits of the two ids cannot join into another pair', () => {
  expect(policyChangeDedupeKey(parseGithubId(9000), 7)).toBe('policy_change:9000:7');
  const keys = [
    policyChangeDedupeKey(parseGithubId(9000), 7),
    policyChangeDedupeKey(parseGithubId(9000), 70),
    policyChangeDedupeKey(parseGithubId(900), 70),
    policyChangeDedupeKey(parseGithubId(90_007), 1),
  ];
  expect(new Set(keys).size).toBe(keys.length);
});
