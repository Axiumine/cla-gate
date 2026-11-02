// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import type { UnlinkedFinding } from './actor-types.ts';
import { sha, unlinkedFinding } from './test-support.ts';
import type { FailureCode } from './types.ts';
import { assessUnlinked, type UnlinkedFix } from './unlinked.ts';

// E08-S05: unlinked findings against the per-commit overrides. Each row hands findings (as extraction produces them)
// and an overrides map to assessUnlinked and names the failure codes, the findings with the override that waives each
// (or null), and the fixes. The wiring with extraction and coverage is in unlinked-commits.test.ts.

interface Row {
  readonly name: string;
  readonly findings: readonly UnlinkedFinding[];
  readonly overrides: readonly (readonly [string, number])[];
  readonly codes: readonly FailureCode[];
  readonly verdicts: readonly (readonly [string, 'author' | 'committer', number | null])[];
  readonly fixes: readonly UnlinkedFix[];
}

const link = (commitSha: string, role: 'author' | 'committer'): UnlinkedFix => ({
  code: 'link_commit_email',
  sha: commitSha,
  role,
});
const override = (commitSha: string): UnlinkedFix => ({ code: 'maintainer_override', sha: commitSha });

const SHA_64 = 'ab'.repeat(32);

const rows: readonly Row[] = [
  { name: 'nothing unlinked, nothing to say', findings: [], overrides: [], codes: [], verdicts: [], fixes: [] },
  {
    name: 'an unlinked author without an override fails and asks for a link and an override',
    findings: [unlinkedFinding(sha(2), 'author')],
    overrides: [],
    codes: ['unlinked_identity'],
    verdicts: [[sha(2), 'author', null]],
    fixes: [link(sha(2), 'author'), override(sha(2))],
  },
  {
    name: 'an unlinked committer without an override fails the same way for its own role',
    findings: [unlinkedFinding(sha(2), 'committer')],
    overrides: [],
    codes: ['unlinked_identity'],
    verdicts: [[sha(2), 'committer', null]],
    fixes: [link(sha(2), 'committer'), override(sha(2))],
  },
  {
    name: 'author and committer both unlinked: two link fixes and a single override fix',
    findings: [unlinkedFinding(sha(2), 'author'), unlinkedFinding(sha(2), 'committer')],
    overrides: [],
    codes: ['unlinked_identity'],
    verdicts: [
      [sha(2), 'author', null],
      [sha(2), 'committer', null],
    ],
    fixes: [link(sha(2), 'author'), link(sha(2), 'committer'), override(sha(2))],
  },
  {
    name: 'an overridden finding passes, carries the override id and asks for nothing',
    findings: [unlinkedFinding(sha(2), 'author')],
    overrides: [[sha(2), 41]],
    codes: [],
    verdicts: [[sha(2), 'author', 41]],
    fixes: [],
  },
  {
    name: 'one override resolves both unlinked identities of a commit',
    findings: [unlinkedFinding(sha(2), 'author'), unlinkedFinding(sha(2), 'committer')],
    overrides: [[sha(2), 41]],
    codes: [],
    verdicts: [
      [sha(2), 'author', 41],
      [sha(2), 'committer', 41],
    ],
    fixes: [],
  },
  {
    name: 'an override for another commit changes nothing and is not listed',
    findings: [unlinkedFinding(sha(2), 'author')],
    overrides: [[sha(3), 41]],
    codes: ['unlinked_identity'],
    verdicts: [[sha(2), 'author', null]],
    fixes: [link(sha(2), 'author'), override(sha(2))],
  },
  {
    name: 'an override SHA in upper case matches the lower-case finding',
    findings: [unlinkedFinding(sha(0xabcdef), 'author')],
    overrides: [[sha(0xabcdef).toUpperCase(), 41]],
    codes: [],
    verdicts: [[sha(0xabcdef), 'author', 41]],
    fixes: [],
  },
  {
    name: 'a finding SHA in upper case matches too, and is reported in lower case',
    findings: [unlinkedFinding(sha(0xabcdef).toUpperCase(), 'author')],
    overrides: [[sha(0xabcdef), 41]],
    codes: [],
    verdicts: [[sha(0xabcdef), 'author', 41]],
    fixes: [],
  },
  {
    name: 'a 64-character SHA is overridden by the same 64 characters',
    findings: [unlinkedFinding(SHA_64, 'committer')],
    overrides: [[SHA_64, 41]],
    codes: [],
    verdicts: [[SHA_64, 'committer', 41]],
    fixes: [],
  },
  {
    name: 'a 64-character SHA is not overridden by its 40-character prefix',
    findings: [unlinkedFinding(SHA_64, 'committer')],
    overrides: [[SHA_64.slice(0, 40), 41]],
    codes: ['unlinked_identity'],
    verdicts: [[SHA_64, 'committer', null]],
    fixes: [link(SHA_64, 'committer'), override(SHA_64)],
  },
  {
    name: 'one commit overridden and another not: only the other one fails and asks for fixes',
    findings: [unlinkedFinding(sha(2), 'author'), unlinkedFinding(sha(3), 'author')],
    overrides: [[sha(2), 41]],
    codes: ['unlinked_identity'],
    verdicts: [
      [sha(2), 'author', 41],
      [sha(3), 'author', null],
    ],
    fixes: [link(sha(3), 'author'), override(sha(3))],
  },
  {
    name: 'two spellings of one SHA: the lowest override id wins, whichever came first',
    findings: [unlinkedFinding(sha(0xabcdef), 'author')],
    overrides: [
      [sha(0xabcdef).toUpperCase(), 90],
      [sha(0xabcdef), 12],
    ],
    codes: [],
    verdicts: [[sha(0xabcdef), 'author', 12]],
    fixes: [],
  },
  {
    name: 'two spellings of one SHA: the lowest override id wins in the other insertion order too',
    findings: [unlinkedFinding(sha(0xabcdef), 'author')],
    overrides: [
      [sha(0xabcdef), 12],
      [sha(0xabcdef).toUpperCase(), 90],
    ],
    codes: [],
    verdicts: [[sha(0xabcdef), 'author', 12]],
    fixes: [],
  },
  {
    name: 'findings and fixes come out sorted by SHA then role, whatever order they came in',
    findings: [
      unlinkedFinding(sha(9), 'committer'),
      unlinkedFinding(sha(2), 'committer'),
      unlinkedFinding(sha(9), 'author'),
      unlinkedFinding(sha(2), 'author'),
    ],
    overrides: [],
    codes: ['unlinked_identity'],
    verdicts: [
      [sha(2), 'author', null],
      [sha(2), 'committer', null],
      [sha(9), 'author', null],
      [sha(9), 'committer', null],
    ],
    fixes: [
      link(sha(2), 'author'),
      link(sha(2), 'committer'),
      link(sha(9), 'author'),
      link(sha(9), 'committer'),
      override(sha(2)),
      override(sha(9)),
    ],
  },
];

test.each(rows)('$name', ({ findings, overrides, codes, verdicts, fixes }) => {
  const result = assessUnlinked(findings, new Map(overrides));
  expect(result.failureCodes).toEqual(codes);
  expect(result.findings.map((finding) => [finding.sha, finding.role, finding.overrideId])).toEqual(verdicts);
  expect(result.fixes).toEqual(fixes);
});

test('the inputs are read, not changed: frozen findings and an untouched overrides map give the same answer', () => {
  const findings = Object.freeze([unlinkedFinding(sha(9), 'author'), unlinkedFinding(sha(2), 'author')]);
  const overrides = new Map([[sha(2).toUpperCase(), 41]]);
  const result = assessUnlinked(findings, overrides);
  expect(result.findings.map((finding) => finding.sha)).toEqual([sha(2), sha(9)]);
  expect(findings.map((finding) => finding.sha)).toEqual([sha(9), sha(2)]);
  expect([...overrides]).toEqual([[sha(2).toUpperCase(), 41]]);
});

test('a finding sorts by SHA before its role, so a later commit never overtakes an earlier one', () => {
  const result = assessUnlinked([unlinkedFinding(sha(3), 'author'), unlinkedFinding(sha(2), 'committer')], new Map());
  expect(result.findings.map((finding) => [finding.sha, finding.role])).toEqual([
    [sha(2), 'committer'],
    [sha(3), 'author'],
  ]);
});
