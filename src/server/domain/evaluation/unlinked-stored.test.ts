// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { unlinkedSchema } from '../../../shared/pr-evaluation-parts.ts';
import { sha, unlinkedFinding } from './test-support.ts';
import { assessUnlinked, storedUnlinked } from './unlinked.ts';

// E08-S05: what leaves the rule. The fixes and the stored findings name commits and roles by code and SHA; the display
// identity (name, email) stays on the in-memory finding for the renderer (E09) and is never written down.

const HOSTILE = { name: '[click](https://evil.example) @maintainer #12', email: 'victim.person+secret@example.org' };

function expectNoPersonalData(value: unknown): void {
  const text = JSON.stringify(value);
  for (const fragment of [HOSTILE.name, HOSTILE.email, 'victim', 'evil.example', '@maintainer', '#12']) {
    expect(text).not.toContain(fragment);
  }
}

const findings = [
  unlinkedFinding(sha(2), 'author', HOSTILE),
  unlinkedFinding(sha(2), 'committer', HOSTILE),
  unlinkedFinding(sha(3), 'author', HOSTILE),
];
const overrides = new Map([[sha(3), 41]]);

test('the fixes carry a code, a SHA and a role, and no name or email', () => {
  const { fixes } = assessUnlinked(findings, overrides);
  expect(fixes).toEqual([
    { code: 'link_commit_email', sha: sha(2), role: 'author' },
    { code: 'link_commit_email', sha: sha(2), role: 'committer' },
    { code: 'maintainer_override', sha: sha(2) },
  ]);
  expectNoPersonalData(fixes);
});

test('the in-memory finding keeps the display identity for the renderer', () => {
  const { findings: assessed } = assessUnlinked(findings, overrides);
  expect(assessed.map((finding) => finding.raw)).toEqual([HOSTILE, HOSTILE, HOSTILE]);
});

test('the stored list has exactly sha, role and overrideId for every finding, overridden or not', () => {
  const stored = storedUnlinked(assessUnlinked(findings, overrides).findings);
  expect(stored).toEqual([
    { sha: sha(2), role: 'author', overrideId: null },
    { sha: sha(2), role: 'committer', overrideId: null },
    { sha: sha(3), role: 'author', overrideId: 41 },
  ]);
  expectNoPersonalData(stored);
});

test.each(storedUnlinked(assessUnlinked(findings, overrides).findings))(
  'the stored finding $sha $role is accepted by the stored-details schema',
  (entry) => {
    expect(unlinkedSchema.safeParse(entry).success).toBe(true);
  },
);

test('upper-case input SHAs are stored in lower case, as the stored-details schema requires', () => {
  const stored = storedUnlinked(
    assessUnlinked([unlinkedFinding(sha(0xabcdef).toUpperCase(), 'author')], new Map()).findings,
  );
  expect(stored).toEqual([{ sha: sha(0xabcdef), role: 'author', overrideId: null }]);
  expect(unlinkedSchema.safeParse(stored[0]).success).toBe(true);
});

test('nothing unlinked stores an empty list', () => {
  expect(storedUnlinked(assessUnlinked([], overrides).findings)).toEqual([]);
});
