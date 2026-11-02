// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { assessListing } from './listing-check.ts';

// E08-S08: what the listing state means for the verdict.

test('a complete listing adds no failure code and no fix', () => {
  expect(assessListing('complete')).toEqual({ failureCodes: [], fixes: [] });
});

test('an exceeded listing fails with commit_limit_exceeded and asks for the pull request to be split', () => {
  expect(assessListing('exceeded')).toEqual({
    failureCodes: ['commit_limit_exceeded'],
    fixes: [{ code: 'split_pull_request' }],
  });
});
