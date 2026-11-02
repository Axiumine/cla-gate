// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseStoredDetails } from '../../../shared/pr-evaluation-details.ts';
import { evaluatePullRequest } from './evaluate.ts';
import { GITHUB_WEB_FLOW_ID } from './github-identities.ts';
import { MAX_EVALUATED_COMMITS } from './listing-plan.ts';
import { toStoredDetails } from './stored-details.ts';
import {
  account,
  coAuthoredBy,
  commitFacts,
  evaluationInput,
  messageEndingWith,
  noreplyEmail,
  sha,
  signatureFact,
} from './test-support.ts';
import type { CommitFacts, EvaluationInput } from './types.ts';

// E08-S08: the size of what is stored. A row of `pr_evaluations` is written for every head SHA, and a pull request can
// have 2,000 commits with two identities and twenty trailers each. The lists of the stored value are bounded by the schema
// (`STORED_LIMITS`), so each shape below, the worst ones the engine can be handed, stays under 256 KiB, and the stored
// value says how much it leaves out. The largest value the schema accepts is checked in src/shared.

const LIMIT = 256 * 1024;
const FIRST_ID = 100_000_000;
const detailsOf = (input: EvaluationInput) => toStoredDetails(evaluatePullRequest(input));
const bytesOf = (input: EvaluationInput): number => new TextEncoder().encode(JSON.stringify(detailsOf(input))).length;
const commitsWith = (build: (index: number) => Partial<CommitFacts>): CommitFacts[] =>
  Array.from({ length: MAX_EVALUATED_COMMITS }, (_unused, index) => commitFacts(index + 10, build(index)));

/** The same pull request with a signature for every actor it has, so that everyone is covered. */
function everyoneSigned(input: EvaluationInput): EvaluationInput {
  const ids = evaluatePullRequest(input).actors.map((actor) => actor.account.id);
  return { ...input, signatures: ids.map((id, index) => signatureFact(index + 1, id, { versionId: 7 })) };
}

/** Twenty distinct trailers: ten that resolve to an account and ten that do not, then a 21st that is not read. */
function trailers(index: number): string {
  const resolvable = Array.from({ length: 10 }, (_unused, k) =>
    coAuthoredBy(noreplyEmail(FIRST_ID * 3 + index * 10 + k)),
  );
  const other = Array.from({ length: 11 }, (_unused, k) => coAuthoredBy(`pair${index}x${k}@example.org`));
  return messageEndingWith(...resolvable, ...other);
}

const ownCommit = (index: number): Partial<CommitFacts> => ({
  author: account(FIRST_ID + index),
  committer: account(FIRST_ID + index),
});
const twoPeople = (index: number): Partial<CommitFacts> => ({
  author: account(FIRST_ID + index),
  committer: account(FIRST_ID * 2 + index),
});
const bothUnlinked = (): Partial<CommitFacts> => ({ author: null, committer: null });

const overridesForAll = new Map(
  Array.from({ length: MAX_EVALUATED_COMMITS }, (_unused, index) => [sha(index + 10), index + 1]),
);

const worstCases: readonly (readonly [string, EvaluationInput])[] = [
  ['2,000 different authors, unsigned', evaluationInput({ commits: commitsWith(ownCommit) })],
  ['2,000 different authors, all signed', everyoneSigned(evaluationInput({ commits: commitsWith(ownCommit) }))],
  [
    '2,000 unlinked authors, committed in the web UI',
    evaluationInput({ commits: commitsWith(() => ({ author: null, committer: account(GITHUB_WEB_FLOW_ID) })) }),
  ],
  ['2,000 commits of two different people each, unsigned', evaluationInput({ commits: commitsWith(twoPeople) })],
  [
    '2,000 commits of two different people each, all signed',
    everyoneSigned(evaluationInput({ commits: commitsWith(twoPeople) })),
  ],
  ['2,000 commits with two unlinked identities each', evaluationInput({ commits: commitsWith(bothUnlinked) })],
  [
    '2,000 commits with two unlinked identities each, all overridden',
    evaluationInput({ commits: commitsWith(bothUnlinked), overrides: overridesForAll }),
  ],
  [
    '2,000 commits with twenty distinct trailers each, all signed',
    everyoneSigned(
      evaluationInput({ commits: commitsWith((index) => ({ ...twoPeople(index), message: trailers(index) })) }),
    ),
  ],
  [
    'twenty distinct trailers, a linked author and an unlinked committer on every commit',
    evaluationInput({
      commits: commitsWith((index) => ({
        author: account(FIRST_ID + index),
        committer: null,
        message: trailers(index),
      })),
    }),
  ],
];

test.each(worstCases)('%s stay under 256 KiB', (_name, input) => {
  expect(bytesOf(input)).toBeLessThan(LIMIT);
});

test.each(worstCases)('%s: the stored value is valid and says what it leaves out', (_name, input) => {
  const details = detailsOf(input);
  expect(parseStoredDetails(details)).toEqual({ ok: true, details });
  expect(details.actors.length).toBeLessThanOrEqual(500);
  expect(details.unlinked.length).toBeLessThanOrEqual(500);
  expect(details.advisories.length).toBeLessThanOrEqual(500);
  expect(details.omitted).toBeDefined();
});

test('2,000 commits by a handful of authors are a few hundred bytes and omit nothing', () => {
  const input = evaluationInput({
    commits: commitsWith((index) => ({ author: account(2 + (index % 5)), committer: account(2 + (index % 5)) })),
  });
  expect(bytesOf(input)).toBeLessThan(2000);
  expect('omitted' in detailsOf(input)).toBe(false);
});
