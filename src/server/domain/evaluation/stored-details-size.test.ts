// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { evaluatePullRequest } from './evaluate.ts';
import { GITHUB_WEB_FLOW_ID } from './github-identities.ts';
import { MAX_EVALUATED_COMMITS } from './listing-plan.ts';
import { toStoredDetails } from './stored-details.ts';
import { account, commitFacts, evaluationInput, signatureFact } from './test-support.ts';
import type { CommitFacts, EvaluationInput } from './types.ts';

// E08-S08: the size of what is stored. A row of `pr_evaluations` is written for every head SHA, so the largest pull request
// the engine evaluates (2,000 commits) is held to 256 KiB. The worst case here is the largest shape in which every commit
// brings one new identity, in the usual git shape where the committer is the author or `web-flow`: 2,000 people who
// signed (about 257 KB with 9-digit GitHub ids, signature ids 1 to 2,000 and a document at version 7), 2,000 who did not
// (about 142 KB), or 2,000 unlinked authors (about 170 KB). A commit that brings two different identities (290 KB for
// two linked ones, 346 KB for two unlinked ones), or twenty trailers, can go beyond it: the story's figure is a budget for the normal worst case, not a bound the schema enforces.

const LIMIT = 256 * 1024;
const FIRST_ID = 100_000_000;
const bytesOf = (input: EvaluationInput): number =>
  new TextEncoder().encode(JSON.stringify(toStoredDetails(evaluatePullRequest(input)))).length;
const commitsWith = (build: (index: number) => Partial<CommitFacts>): CommitFacts[] =>
  Array.from({ length: MAX_EVALUATED_COMMITS }, (_unused, index) => commitFacts(index + 10, build(index)));
const ownCommit = (index: number): Partial<CommitFacts> => ({
  author: account(FIRST_ID + index),
  committer: account(FIRST_ID + index),
});

test('2,000 commits by 2,000 different signed authors stay under 256 KiB', () => {
  const signatures = Array.from({ length: MAX_EVALUATED_COMMITS }, (_unused, index) =>
    signatureFact(index + 1, FIRST_ID + index, { versionId: 7 }),
  );
  expect(bytesOf(evaluationInput({ commits: commitsWith(ownCommit), signatures }))).toBeLessThan(LIMIT);
});

test('2,000 commits by 2,000 different unsigned authors stay under 256 KiB', () => {
  expect(bytesOf(evaluationInput({ commits: commitsWith(ownCommit) }))).toBeLessThan(LIMIT);
});

test('2,000 commits by unlinked authors, committed in the web UI, stay under 256 KiB', () => {
  const commits = commitsWith(() => ({ author: null, committer: account(GITHUB_WEB_FLOW_ID) }));
  expect(bytesOf(evaluationInput({ commits }))).toBeLessThan(LIMIT);
});

test('2,000 commits by a handful of authors are a few hundred bytes', () => {
  const commits = commitsWith((index) => ({ author: account(2 + (index % 5)), committer: account(2 + (index % 5)) }));
  expect(bytesOf(evaluationInput({ commits }))).toBeLessThan(2000);
});
