// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { isPublicUrl, PUBLIC_REFUSAL_HEADERS } from './public-headers.ts';

// The pieces of the headers of the public API (E22-S02) that have no server of their own: the test of the paths it owns and the headers of a
// refusal. The headers of a good call, of a refusal and of a failure before routing are shown on the real application in
// public-verification-routes*.test.ts.

test.each([
  ['/api/public/repos/9000/signers/octocat', true],
  ['/api/public/', true],
  ['/api/public/repos/9000/signers/octocat?x=1', true],
  ['/api/public', false],
  ['/api/publicity/x', false],
  ['/api/installations/5/documents', false],
  ['/API/public/x', false],
  ['/x/api/public/y', false],
  ['', false],
])('%j is a path of the public API: %s', (url, expected) => {
  expect(isPublicUrl(url)).toBe(expected);
});

test('a refusal of the public API is readable by any site and never kept by a cache', () => {
  expect(PUBLIC_REFUSAL_HEADERS).toEqual({ 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
});
