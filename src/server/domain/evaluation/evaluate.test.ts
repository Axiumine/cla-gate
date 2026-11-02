// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { evaluatePullRequest } from './evaluate.ts';
import {
  account,
  allowlistEntry,
  coAuthoredBy,
  commitFacts,
  evaluationInput,
  messageEndingWith,
  noreplyEmail,
  sha,
  signatureFact,
} from './test-support.ts';
import type { CommitFacts, EvaluationInput } from './types.ts';

// E08-S08: how the rules compose. The opener (user 1) and the author of commit 2 have signed unless a test says otherwise,
// and the policy is document 1 at major 1.

const signed = [signatureFact(10, 1), signatureFact(20, 2)];
const unlinkedCommit = commitFacts(3, { author: null, committer: null });

const namedInputs: readonly (readonly [string, EvaluationInput])[] = [
  ['everyone signed', evaluationInput({ commits: [commitFacts(2)], signatures: signed })],
  ['an unsigned author', evaluationInput({ commits: [commitFacts(2)], signatures: [signatureFact(10, 1)] })],
  ['an exceeded listing', evaluationInput({ listing: 'exceeded', signatures: signed })],
  ['no active CLA', evaluationInput({ policy: null, signatures: signed })],
  ['an unlinked author', evaluationInput({ commits: [unlinkedCommit], signatures: signed })],
  [
    'an unlinked author with an override',
    evaluationInput({ commits: [unlinkedCommit], signatures: signed, overrides: new Map([[sha(3), 9]]) }),
  ],
  ['a bot opener', evaluationInput({ opener: account(500, 'Bot'), commits: [commitFacts(2)], signatures: signed })],
];

test.each(namedInputs)('the outcome is success exactly when there is no failure code: %s', (_name, input) => {
  const evaluation = evaluatePullRequest(input);
  expect(evaluation.outcome === 'success').toBe(evaluation.failureCodes.length === 0);
});

test('a passing result still records why it passed: the bases, the advisories and no fix', () => {
  const evaluation = evaluatePullRequest(
    evaluationInput({
      commits: [commitFacts(2, { message: messageEndingWith(coAuthoredBy('pair@example.org')) }), commitFacts(4)],
      signatures: signed,
      allowlist: [allowlistEntry(5, 'user', 4)],
    }),
  );
  expect(evaluation.outcome).toBe('success');
  expect(evaluation.failureCodes).toEqual([]);
  expect(evaluation.fixes).toEqual([]);
  expect(evaluation.actors.map((actor) => [actor.account.id, actor.basis?.kind])).toEqual([
    [1, 'signature'],
    [2, 'signature'],
    [4, 'allowlist'],
  ]);
  expect(evaluation.advisories).toEqual([{ code: 'co_author_unresolved', sha: sha(2) }]);
});

test('a failing result carries the covered actors too, not only the ones that fail', () => {
  const evaluation = evaluatePullRequest(
    evaluationInput({ commits: [commitFacts(2), commitFacts(3)], signatures: signed }),
  );
  expect(evaluation.outcome).toBe('failure');
  expect(evaluation.actors.map((actor) => [actor.account.id, actor.covered])).toEqual([
    [1, true],
    [2, true],
    [3, false],
  ]);
});

test('the result echoes the policy and the listing it was judged under', () => {
  const evaluation = evaluatePullRequest(evaluationInput({ policy: { documentId: 7, activeMajor: 3 } }));
  expect(evaluation).toMatchObject({ policy: { documentId: 7, activeMajor: 3 }, listing: 'complete' });
});

test('an exceeded listing reads none of the commits it was handed, whatever they say', () => {
  const evaluation = evaluatePullRequest(
    evaluationInput({
      listing: 'exceeded',
      commits: [
        commitFacts(2),
        unlinkedCommit,
        commitFacts(4, { message: messageEndingWith(coAuthoredBy(noreplyEmail(40, 'pairing'))) }),
      ],
      signatures: signed,
    }),
  );
  expect(evaluation).toMatchObject({ outcome: 'failure', failureCodes: ['commit_limit_exceeded'] });
  expect(evaluation.actors.map((actor) => actor.account.id)).toEqual([1]);
  expect(evaluation).toMatchObject({ findings: [], advisories: [], commitCount: 0, mergeCommitsSkipped: 0 });
  expect(evaluation.fixes).toEqual([{ code: 'split_pull_request' }]);
});

test('an exceeded listing still assesses the opener, whatever the commits would have been', () => {
  const evaluation = evaluatePullRequest(evaluationInput({ listing: 'exceeded' }));
  expect(evaluation.failureCodes).toEqual(['commit_limit_exceeded', 'unsigned_contributor']);
  expect(evaluation.fixes).toEqual([{ code: 'sign_cla', githubId: 1 }, { code: 'split_pull_request' }]);
});

test('no active CLA is the one failure code, whatever else is wrong, and no fix is offered', () => {
  const evaluation = evaluatePullRequest(
    evaluationInput({
      policy: null,
      commits: [commitFacts(2), unlinkedCommit],
      allowlist: [allowlistEntry(1, 'user', 2)],
      signatures: signed,
    }),
  );
  expect(evaluation.failureCodes).toEqual(['no_active_cla']);
  expect(evaluation.fixes).toEqual([]);
  expect(evaluation.policy).toBeNull();
  expect(evaluation.actors.map((actor) => [actor.account.id, actor.covered, actor.basis])).toEqual([
    [1, false, null],
    [2, false, null],
  ]);
  expect(evaluation.findings.map((finding) => [finding.sha, finding.role, finding.overrideId])).toEqual([
    [sha(3), 'author', null],
    [sha(3), 'committer', null],
  ]);
});

test('no active CLA wins over an exceeded listing: the commits are not read and only that code is given', () => {
  const evaluation = evaluatePullRequest(
    evaluationInput({ policy: null, listing: 'exceeded', commits: [commitFacts(2)] }),
  );
  expect(evaluation.failureCodes).toEqual(['no_active_cla']);
  expect(evaluation.fixes).toEqual([]);
  expect(evaluation.actors.map((actor) => actor.account.id)).toEqual([1]);
});

test('failure codes are sorted and unique however many actors share one', () => {
  const evaluation = evaluatePullRequest(
    evaluationInput({
      opener: account(5),
      commits: [
        commitFacts(2),
        commitFacts(3),
        commitFacts(4, { author: account(600, 'Bot'), committer: null }),
        unlinkedCommit,
      ],
    }),
  );
  expect(evaluation.failureCodes).toEqual(['bot_not_allowlisted', 'unlinked_identity', 'unsigned_contributor']);
});

test('fixes of every source come out sorted by code, then by id or SHA', () => {
  const bot = account(60, 'Bot');
  const evaluation = evaluatePullRequest(
    evaluationInput({
      commits: [
        commitFacts(30, { author: bot, committer: bot }),
        commitFacts(31, { author: account(50, 'Organization'), committer: account(9) }),
        commitFacts(32, { author: null, committer: account(4) }),
        commitFacts(33, { author: null, committer: account(2) }),
      ],
      signatures: [signatureFact(20, 2)],
    }),
  );
  expect(evaluation.fixes).toEqual([
    { code: 'allowlist_account', githubId: 50 },
    { code: 'allowlist_bot', githubId: 60 },
    { code: 'link_commit_email', sha: sha(32), role: 'author' },
    { code: 'link_commit_email', sha: sha(33), role: 'author' },
    { code: 'maintainer_override', sha: sha(32) },
    { code: 'maintainer_override', sha: sha(33) },
    { code: 'sign_cla', githubId: 1 },
    { code: 'sign_cla', githubId: 4 },
    { code: 'sign_cla', githubId: 9 },
  ]);
});

test('commits are counted once per SHA, merge commits included, and the skipped merges are counted apart', () => {
  const commits = [
    commitFacts(2),
    commitFacts(2),
    { ...commitFacts(2), sha: sha(2).toUpperCase() },
    commitFacts(3, { parents: [sha(1), sha(2)] }),
    commitFacts(4, { parents: [] }),
  ];
  const evaluation = evaluatePullRequest(evaluationInput({ commits, signatures: signed }));
  expect(evaluation).toMatchObject({ commitCount: 3, mergeCommitsSkipped: 1 });
});

test('every SHA in the result is lower case, however the commits spell it', () => {
  const upper = (n: number, overrides: Partial<CommitFacts> = {}): CommitFacts => ({
    ...commitFacts(n, overrides),
    sha: sha(n).toUpperCase(),
  });
  const evaluation = evaluatePullRequest(
    evaluationInput({
      commits: [
        upper(0xab, { message: messageEndingWith(coAuthoredBy('pair@example.org')) }),
        upper(0xcd, { author: null, committer: account(2) }),
      ],
      signatures: signed,
    }),
  );
  expect(evaluation.actors.flatMap((actor) => actor.shas)).toEqual([sha(0xcd), sha(0xab)]);
  expect(evaluation.findings.map((finding) => finding.sha)).toEqual([sha(0xcd)]);
  expect(evaluation.advisories.map((advisory) => advisory.sha)).toEqual([sha(0xab)]);
  expect(evaluation.fixes).toContainEqual({ code: 'maintainer_override', sha: sha(0xcd) });
});

test('the display-only raw identity stays on the in-memory finding for the renderer', () => {
  const evaluation = evaluatePullRequest(
    evaluationInput({
      commits: [commitFacts(2, { author: null, rawAuthor: { name: 'Ada Example', email: 'ada@example.org' } })],
      signatures: signed,
    }),
  );
  expect(evaluation.findings[0]?.raw).toEqual({ name: 'Ada Example', email: 'ada@example.org' });
});

test('the input is not changed: a frozen input evaluates and reads back the same', () => {
  const input = evaluationInput({ commits: [commitFacts(2), unlinkedCommit], signatures: signed });
  const before = JSON.stringify(input);
  Object.freeze(input.commits);
  Object.freeze(input.signatures);
  evaluatePullRequest(input);
  expect(JSON.stringify(input)).toBe(before);
});
