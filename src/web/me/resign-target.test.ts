// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { resignRepositoryId } from './resign-target.ts';

// E18-S03: where "Sign again" leads.

test.each([
  ['/sign/123', 123],
  ['/sign/1', 1],
  ['/sign/9007199254740991', 9_007_199_254_740_991],
])('%s is the sign page of repository %d', (path, id) => {
  expect(resignRepositoryId(path)).toBe(id);
});

test.each([
  ['no path', null],
  ['a number longer than a safe integer', '/sign/99999999999999999999'],
  ['a number past the largest safe integer', '/sign/9007199254740993'],
])('%s leads nowhere', (_what, path) => {
  expect(resignRepositoryId(path)).toBeUndefined();
});
