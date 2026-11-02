// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import type { EvaluationFix } from './evaluation-types.ts';
import { compareEvaluationFixes } from './fixes.ts';
import { sha, shuffled } from './test-support.ts';

// E08-S08: the one order of fixes, by code and then by what the fix points at.

const inOrder: readonly EvaluationFix[] = [
  { code: 'allowlist_account', githubId: 4 },
  { code: 'allowlist_account', githubId: 12 },
  { code: 'allowlist_bot', githubId: 3 },
  { code: 'link_commit_email', sha: sha(5), role: 'author' },
  { code: 'link_commit_email', sha: sha(5), role: 'committer' },
  { code: 'link_commit_email', sha: sha(6), role: 'author' },
  { code: 'maintainer_override', sha: sha(5) },
  { code: 'maintainer_override', sha: sha(6) },
  { code: 'sign_cla', githubId: 2 },
  { code: 'sign_cla', githubId: 10 },
  { code: 'split_pull_request' },
];

test.each([1, 2, 3, 4, 5, 6, 7, 8])('shuffled fixes (seed %i) sort into the one order', (seed) => {
  expect(shuffled(inOrder, seed).sort(compareEvaluationFixes)).toEqual(inOrder);
});

test('ids compare as numbers, not as text: 10 comes after 2', () => {
  expect(compareEvaluationFixes({ code: 'sign_cla', githubId: 10 }, { code: 'sign_cla', githubId: 2 })).toBeGreaterThan(
    0,
  );
});

test('a fix is not before or after itself', () => {
  expect(compareEvaluationFixes({ code: 'sign_cla', githubId: 2 }, { code: 'sign_cla', githubId: 2 })).toBe(0);
  expect(compareEvaluationFixes({ code: 'split_pull_request' }, { code: 'split_pull_request' })).toBe(0);
});

test('the code decides before the target: allowlist_bot 900 comes before sign_cla 1', () => {
  expect(
    compareEvaluationFixes({ code: 'allowlist_bot', githubId: 900 }, { code: 'sign_cla', githubId: 1 }),
  ).toBeLessThan(0);
});
