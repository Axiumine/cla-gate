// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { findCoveringSignature } from './signatures.ts';
import { shuffled, signatureFact } from './test-support.ts';
import type { Policy, SignatureBasis, SignatureFact } from './types.ts';

// E08-S04: the signature half of coverage. Each row names the user, the policy and the facts, and says which signature
// id is the basis (null for none). Signature ids are distinct inside a row, so the winner is readable.

interface Row {
  readonly name: string;
  readonly githubId: number;
  readonly policy: Policy;
  readonly facts: readonly SignatureFact[];
  readonly expected: number | null;
}

const v2: Policy = { documentId: 1, activeMajor: 2 };
const MAX = Number.MAX_SAFE_INTEGER;

const rows: readonly Row[] = [
  {
    name: 'a signature at the active major covers',
    githubId: 10,
    policy: v2,
    facts: [signatureFact(1, 10, { major: 2 })],
    expected: 1,
  },
  {
    name: 'a lower major does not cover',
    githubId: 10,
    policy: v2,
    facts: [signatureFact(1, 10, { major: 1 })],
    expected: null,
  },
  {
    name: 'a higher major does not cover either (a rollback publishes a new version, equality is the rule)',
    githubId: 10,
    policy: v2,
    facts: [signatureFact(1, 10, { major: 3 })],
    expected: null,
  },
  {
    name: 'a signature of another document is ignored',
    githubId: 10,
    policy: v2,
    facts: [signatureFact(1, 10, { major: 2, documentId: 2 })],
    expected: null,
  },
  {
    name: 'a revoked signature is ignored',
    githubId: 10,
    policy: v2,
    facts: [signatureFact(1, 10, { major: 2, revoked: true })],
    expected: null,
  },
  {
    name: 'a signature of another user is ignored',
    githubId: 10,
    policy: v2,
    facts: [signatureFact(1, 11, { major: 2 })],
    expected: null,
  },
  {
    name: 'no facts at all cover nobody',
    githubId: 10,
    policy: v2,
    facts: [],
    expected: null,
  },
  {
    name: 'two matching facts: the lowest signature id is the basis, listed first',
    githubId: 10,
    policy: v2,
    facts: [signatureFact(3, 10, { major: 2 }), signatureFact(5, 10, { major: 2 })],
    expected: 3,
  },
  {
    name: 'two matching facts: the lowest signature id is the basis, listed last',
    githubId: 10,
    policy: v2,
    facts: [signatureFact(5, 10, { major: 2 }), signatureFact(3, 10, { major: 2 })],
    expected: 3,
  },
  {
    name: 'a revoked fact with the lowest id loses to a live one',
    githubId: 10,
    policy: v2,
    facts: [signatureFact(1, 10, { major: 2, revoked: true }), signatureFact(4, 10, { major: 2 })],
    expected: 4,
  },
  {
    name: 'the matching fact is found among misses of every kind',
    githubId: 10,
    policy: v2,
    facts: [
      signatureFact(1, 10, { major: 1 }),
      signatureFact(2, 11, { major: 2 }),
      signatureFact(3, 10, { major: 2, documentId: 9 }),
      signatureFact(4, 10, { major: 2, revoked: true }),
      signatureFact(9, 10, { major: 2 }),
    ],
    expected: 9,
  },
  {
    name: 'the smallest ids work (user 1, signature 1)',
    githubId: 1,
    policy: { documentId: 1, activeMajor: 1 },
    facts: [signatureFact(1, 1)],
    expected: 1,
  },
  {
    name: 'the largest ids work (user, document and signature at MAX_SAFE_INTEGER)',
    githubId: MAX,
    policy: { documentId: MAX, activeMajor: 1 },
    facts: [signatureFact(MAX, MAX, { documentId: MAX })],
    expected: MAX,
  },
  {
    name: 'ids one apart are different users at the top of the range',
    githubId: MAX,
    policy: { documentId: 1, activeMajor: 1 },
    facts: [signatureFact(1, MAX - 1)],
    expected: null,
  },
];

test.each(rows)('$name', ({ githubId, policy, facts, expected }) => {
  expect(findCoveringSignature(githubId, policy, facts)?.signatureId ?? null).toBe(expected);
});

test('the basis names the signature, its version row and its major, and nothing else', () => {
  const basis: SignatureBasis | null = findCoveringSignature(10, v2, [
    signatureFact(7, 10, { major: 2, versionId: 42 }),
  ]);
  expect(basis).toEqual({ kind: 'signature', signatureId: 7, versionId: 42, major: 2 });
});

test('minor versions play no part: versions of one major cover alike, whatever their version row ids say', () => {
  // 2.0 and 2.1 are two version rows of major 2. The input carries no minor, and the lowest signature id still wins even
  // though its version row has the highest id.
  const facts = [
    signatureFact(2, 10, { major: 2, versionId: 900 }),
    signatureFact(1, 10, { major: 2, versionId: 800 }),
  ];
  expect(findCoveringSignature(10, v2, facts)).toEqual({ kind: 'signature', signatureId: 1, versionId: 800, major: 2 });
  const onlyHigherVersionRow = [signatureFact(2, 10, { major: 1, versionId: 900 })];
  expect(findCoveringSignature(10, v2, onlyHigherVersionRow)).toBeNull();
});

test('the order of the facts never changes the basis (100 seeded shuffles)', () => {
  const facts = [
    signatureFact(8, 10, { major: 2 }),
    signatureFact(6, 10, { major: 2 }),
    signatureFact(2, 10, { major: 1 }),
    signatureFact(3, 10, { major: 2, revoked: true }),
    signatureFact(4, 11, { major: 2 }),
    signatureFact(5, 10, { major: 2, documentId: 5 }),
  ];
  for (let seed = 1; seed <= 100; seed += 1) {
    expect(findCoveringSignature(10, v2, shuffled(facts, seed))?.signatureId).toBe(6);
  }
});

test('the facts are left exactly as they were', () => {
  const facts = [signatureFact(2, 10, { major: 2 }), signatureFact(1, 10, { major: 2 })];
  const before = structuredClone(facts);
  findCoveringSignature(10, v2, facts);
  expect(facts).toEqual(before);
});
