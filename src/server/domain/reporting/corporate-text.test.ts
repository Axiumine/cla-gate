// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { corporateLine, coverageSentence } from './check-output.ts';
import { commentBody } from './comment-body.ts';
import { coverageCounts } from './coverage-counts.ts';
import { InvalidIdError } from './encode.ts';
import { unsignedPeople } from './failure-people.ts';
import { corporateParts } from './failure-sections.ts';
import { OUTDATED_CORPORATE_NOTE } from './failure-text.ts';
import { actor, evaluationOf, NO_NAMES } from './test-support.ts';

// E21-S05: the words about a corporate CLA, one by one, from plain data. The verdicts of the real engine are in domain/reporting-corporate.test.ts.

const SHA = 'a'.repeat(40);

test.each([
  [0, null],
  [1, '1 contributor is covered by a corporate CLA.'],
  [2, '2 contributors are covered by a corporate CLA.'],
  [1000, '1000 contributors are covered by a corporate CLA.'],
] as const)('the corporate sentence for %i people is %j', (count, sentence) => {
  expect(corporateLine(count)).toBe(sentence);
});

test.each([-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
  'a corporate count of %s is refused, as every count is',
  (count) => {
    expect(() => corporateLine(count)).toThrow(InvalidIdError);
  },
);

test('the coverage sentence counts the corporate people in its total and names them by kind, between the allowlist and the override', () => {
  expect(coverageSentence({ signature: 1, allowlist: 1, corporate: 2, override: 1 })).toBe(
    '5 contributors covered: 1 by signature, 1 by allowlist rule, 2 by corporate CLA, 1 by maintainer override.',
  );
  expect(coverageSentence({ signature: 0, allowlist: 0, corporate: 1, override: 0 })).toBe(
    '1 contributor covered: 1 by corporate CLA.',
  );
});

test('only a covering basis of kind corporate_approval is counted as a corporate cover, once per person', () => {
  const kinds = ['signature', 'corporate_approval', 'corporate_approval', 'allowlist', null];
  const counts = coverageCounts({
    actors: kinds.map((kind) => ({ basis: kind === null ? null : { kind } })),
    findings: [],
  });
  expect(counts).toEqual({ signature: 1, allowlist: 1, corporate: 2, override: 0 });
});

test('the comment of a pass says "covered by a corporate CLA" only when the count is above zero, and counts them', () => {
  expect(commentBody({ kind: 'success', headSha: SHA, corporate: 0 })).toBe(
    commentBody({ kind: 'success', headSha: SHA }),
  );
  expect(commentBody({ kind: 'success', headSha: SHA })).toMatch(
    /\nAll contributors have signed the CLA for commit a{7}\.$/,
  );
  expect(commentBody({ kind: 'success', headSha: SHA, corporate: 3 })).toMatch(
    /\nAll contributors have signed the CLA or are covered by a corporate CLA for commit a{7}\. 3 contributors are covered by a corporate CLA\.$/,
  );
});

test('the failure sentence counts the actors that are covered by a corporate approval and no other', () => {
  const corporate = (id: number) => ({
    ...actor(id, ['author']),
    covered: true,
    basis: { kind: 'corporate_approval' },
  });
  const evaluation = evaluationOf({
    actors: [
      corporate(1),
      corporate(2),
      { ...actor(3, ['author']), covered: true, basis: { kind: 'signature' } },
      { ...actor(4, ['author']), covered: false, basis: null },
      { ...actor(5, ['author']), covered: false, corporateOutdated: true },
    ],
  });
  expect(corporateParts(evaluation)).toEqual([
    { kind: 'text', text: '2 contributors are covered by a corporate CLA.' },
  ]);
  expect(corporateParts(evaluationOf({ actors: [actor(4, ['author'])] }))).toEqual([]);
});

test('only the accounts marked as outdated carry the note, and the note names no company, domain or organisation', () => {
  const evaluation = evaluationOf({
    actors: [actor(1, ['author']), { ...actor(2, ['committer']), corporateOutdated: true }],
  });
  const people = unsignedPeople(evaluation, NO_NAMES);
  expect(people.entries).toEqual([
    '- `(unnamed)` (GitHub id 1): commit author',
    `- \`(unnamed)\` (GitHub id 2): committer (${OUTDATED_CORPORATE_NOTE})`,
  ]);
  expect(people.canSign).toBe(true);
  expect(OUTDATED_CORPORATE_NOTE).toContain('ask the CLA manager to sign the current version');
});
