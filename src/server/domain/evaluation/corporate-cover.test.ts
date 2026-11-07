// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { type CorporateApprovalFact, indexCorporateCover } from './corporate-cover.ts';
import { shuffled } from './test-support.ts';

// E21-S05: who the approvals of a corporate agreement cover, from plain facts. Each row says what the adapter read for the people of one
// pull request: the approval, its agreement, the person, the major the agreement was signed under and the major in force. Nothing here is
// a name, a domain or a company.

/** An approval in force for a person under an agreement signed at `agreementMajor`, the active major being 2 unless said. */
const fact = (
  approvalId: number,
  githubId: number,
  agreementMajor: number,
  overrides: Partial<CorporateApprovalFact> = {},
): CorporateApprovalFact => ({
  approvalId,
  agreementId: 100 + approvalId,
  githubId,
  agreementMajor,
  activeMajor: 2,
  ...overrides,
});

interface Row {
  readonly name: string;
  readonly facts: readonly CorporateApprovalFact[];
  readonly covered: readonly (readonly [githubId: number, agreementId: number, approvalId: number])[];
  readonly outdated: readonly number[];
}

const rows: readonly Row[] = [
  { name: 'nothing read, nobody covered', facts: [], covered: [], outdated: [] },
  { name: 'an agreement at the active major covers', facts: [fact(7, 10, 2)], covered: [[10, 107, 7]], outdated: [] },
  {
    name: 'an agreement of an earlier major covers nobody and marks the person',
    facts: [fact(7, 10, 1)],
    covered: [],
    outdated: [10],
  },
  {
    name: 'a higher major than the active one is no more valid, and nobody can mend it by signing',
    facts: [fact(7, 10, 3)],
    covered: [],
    outdated: [],
  },
  {
    name: 'covered under one agreement and behind under another: covered, not outdated',
    facts: [fact(7, 10, 1), fact(9, 10, 2)],
    covered: [[10, 109, 9]],
    outdated: [],
  },
  {
    name: 'two approvals in force: the lowest approval id is the basis whatever the order',
    facts: [fact(9, 10, 2), fact(4, 10, 2), fact(6, 10, 2)],
    covered: [[10, 104, 4]],
    outdated: [],
  },
  {
    name: 'the same approval id twice is one approval: the first of the two stays the basis',
    facts: [fact(7, 10, 2, { agreementId: 201 }), fact(7, 10, 2, { agreementId: 202 })],
    covered: [[10, 201, 7]],
    outdated: [],
  },
  {
    name: 'people are told apart by their numeric id',
    facts: [fact(7, 10, 2), fact(8, 11, 1), fact(9, 12, 2)],
    covered: [
      [10, 107, 7],
      [12, 109, 9],
    ],
    outdated: [11],
  },
  {
    name: 'the active major of each fact is its own: a repository with another document has another major',
    facts: [fact(7, 10, 3, { activeMajor: 3 }), fact(8, 11, 3, { activeMajor: 4 })],
    covered: [[10, 107, 7]],
    outdated: [11],
  },
];

test.each(rows)('$name', ({ facts, covered, outdated }) => {
  const result = indexCorporateCover(facts);
  expect([...result.covered].map(([githubId, cover]) => [githubId, cover.agreementId, cover.approvalId])).toEqual(
    covered,
  );
  expect([...result.outdated]).toEqual(outdated);
});

test('the answer does not depend on the order of the facts', () => {
  const facts = [fact(9, 10, 2), fact(4, 10, 2), fact(6, 11, 1), fact(2, 11, 1), fact(5, 12, 2), fact(3, 13, 3)];
  const expected = indexCorporateCover(facts);
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const again = indexCorporateCover(shuffled(facts, seed));
    expect(new Map([...again.covered].sort(([a], [b]) => a - b))).toEqual(
      new Map([...expected.covered].sort(([a], [b]) => a - b)),
    );
    expect([...again.outdated].sort((a, b) => a - b)).toEqual([...expected.outdated].sort((a, b) => a - b));
  }
});
