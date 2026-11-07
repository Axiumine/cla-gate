// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  allowlistEntry,
  commitFacts,
  corporateCover,
  evaluationInput,
  signatureFact,
  verdictLines,
} from './test-support.ts';

// E21-S05, golden scenarios about people a corporate CLA covers. Each snapshot is the stored details plus the fixes, so a change to any rule
// shows up here as a reviewable diff. The agreement is 4 and the approvals are numbered after the user they cover (user 2 by approval 52);
// the policy is document 1 at major 1; user 1 opens the pull request and users 2 and 3 write the commits.

test('golden: the opener and an author covered by approvals of a corporate CLA, the other author by signature', () => {
  const input = evaluationInput({
    commits: [commitFacts(2), commitFacts(3)],
    signatures: [signatureFact(30, 3)],
    corporateCovered: corporateCover([1, 4, 51], [2, 4, 52]),
  });
  expect(verdictLines(input)).toMatchInlineSnapshot(`
    [
      "success: no failure code",
      "document 1, major 1, listing complete",
      "2 commits, 0 merge commits skipped",
      "actor 1 opener: covered by corporate approval 51 (agreement 4)",
      "actor 2 author: covered by corporate approval 52 (agreement 4)",
      "actor 3 author: covered by signature 30 (version 1030, major 1)",
    ]
  `);
});

test('golden: the opener is covered but one committer is not: the pull request fails', () => {
  const input = evaluationInput({
    commits: [commitFacts(2), commitFacts(3)],
    corporateCovered: corporateCover([1, 4, 51], [2, 4, 52]),
  });
  expect(verdictLines(input)).toMatchInlineSnapshot(`
    [
      "failure: unsigned_contributor",
      "document 1, major 1, listing complete",
      "2 commits, 0 merge commits skipped",
      "actor 1 opener: covered by corporate approval 51 (agreement 4)",
      "actor 2 author: covered by corporate approval 52 (agreement 4)",
      "actor 3 author: uncovered",
      "fix sign_cla 3",
    ]
  `);
});

test('golden: a signature and an allowlist entry win over an approval of the same person, and an approval covers the one left', () => {
  const input = evaluationInput({
    commits: [commitFacts(2), commitFacts(3)],
    signatures: [signatureFact(10, 1)],
    allowlist: [allowlistEntry(1, 'user', 2)],
    corporateCovered: corporateCover([1, 4, 51], [2, 4, 52], [3, 4, 53]),
  });
  expect(verdictLines(input)).toMatchInlineSnapshot(`
    [
      "success: no failure code",
      "document 1, major 1, listing complete",
      "2 commits, 0 merge commits skipped",
      "actor 1 opener: covered by signature 10 (version 1010, major 1)",
      "actor 2 author: covered by allowlist entry 1 (user, repository)",
      "actor 3 author: covered by corporate approval 53 (agreement 4)",
    ]
  `);
});
