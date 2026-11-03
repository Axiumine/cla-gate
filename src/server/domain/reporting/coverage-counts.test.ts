// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { coverageCounts } from './coverage-counts.ts';

// E09-S02: the numbers behind the success summary, from plain data. The verdicts of the real engine are in
// domain/reporting-evaluation.test.ts.

test('only the actors and the findings are read: a name in a finding changes nothing', () => {
  const finding = { sha: 'a'.repeat(40), overrideId: 4, role: 'author', raw: { name: '@everyone', email: 'a@b.co' } };
  expect(coverageCounts({ actors: [], findings: [finding, { ...finding, role: 'committer' }] })).toEqual({
    signature: 0,
    allowlist: 0,
    override: 1,
  });
});
