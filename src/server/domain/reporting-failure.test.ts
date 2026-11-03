// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import type { CommitFacts } from './evaluation/index.ts';
import { type Evaluation, evaluatePullRequest, unresolvedCoAuthorNames } from './evaluation/index.ts';
import {
  account,
  coAuthoredBy,
  commitFacts,
  evaluationInput,
  messageEndingWith,
  noreplyEmail,
  signatureFact,
} from './evaluation/test-support.ts';
import { renderCheckOutput } from './reporting/check-output.ts';
import type { DisplayNames } from './reporting/display-names.ts';
import { failureReport } from './reporting/failure-report.ts';
import { requestOf, sha, showZeroWidth, unguardedMarks } from './reporting/test-support.ts';

// E09-S03: the failure report over the verdicts of the real engine (E08), not over hand-made data. The report describes an
// evaluation by the fields it reads, and handing it the engine's own value type-checks that they exist and means the same.
// Four representative outcomes are stored as snapshots a person can read: unsigned only, unlinked only, both, and 300 commits.

const KNOWN_LOGINS = [
  [1, 'octocat'],
  [2, 'hubot'],
  [3, 'monalisa'],
  [4, 'dependabot[bot]'],
] as const;

/** What must never be in a report: an address, or the part of one that a private commit holds. */
const PRIVATE = /private\.example|jane\.doe/iu;

/** The names the job would hand over: the logins it saw, and the unresolved trailer names of each commit. */
function namesFor(input: ReturnType<typeof evaluationInput>): DisplayNames {
  const seen = input.commits.flatMap((commit) => [commit.author, commit.committer]);
  return {
    logins: new Map([
      ...seen.flatMap((account) => (account === null ? [] : [[account.id, `login-${account.id}`] as const])),
      ...KNOWN_LOGINS,
    ]),
    coAuthors: new Map(
      input.commits
        .map((commit) => [commit.sha, unresolvedCoAuthorNames(commit.message)] as const)
        .filter(([, names]) => names.length > 0),
    ),
  };
}

/** The Check Run of an evaluation of `input`, as a readable text: conclusion, title and summary, each zero-width space shown. */
function checkRunText(input: ReturnType<typeof evaluationInput>): { evaluation: Evaluation; text: string } {
  const evaluation = evaluatePullRequest(input);
  const { view } = failureReport(requestOf({ evaluation, names: namesFor(input) }));
  const output = renderCheckOutput(view);
  const text = `${output.status} ${output.conclusion}\n\n${output.title}\n\n${showZeroWidth(output.summary)}\n`;
  return { evaluation, text };
}

const SIGNED = [signatureFact(1, 3)];

/** Commit `n` of the engine's builders, with a SHA that starts with `n`, so the short SHA of an entry tells commits apart. */
function commit(n: number, overrides: Partial<CommitFacts> = {}): CommitFacts {
  return commitFacts(n, { sha: sha(n), parents: [sha(n - 1)], ...overrides });
}

const UNSIGNED_ONLY = evaluationInput({
  opener: account(1),
  signatures: SIGNED,
  commits: [
    commit(2, { author: account(2), committer: account(2) }),
    commit(3, { author: account(3), committer: account(1) }),
  ],
});

const UNLINKED_ONLY = evaluationInput({
  opener: account(3),
  signatures: SIGNED,
  commits: [
    commit(2, {
      author: null,
      committer: account(3),
      rawAuthor: { name: 'Jane Doe', email: 'jane.doe@private.example' },
    }),
    commit(3, {
      author: account(3),
      committer: null,
      rawCommitter: { name: 'Pat Committer', email: 'pat@private.example' },
    }),
  ],
});

const BOTH = evaluationInput({
  opener: account(1),
  signatures: SIGNED,
  commits: [
    commit(2, {
      author: account(2),
      committer: null,
      rawCommitter: { name: 'Pat Committer', email: 'pat@private.example' },
    }),
    commit(3, {
      author: null,
      committer: null,
      rawAuthor: { name: 'Jane Doe', email: 'jane.doe@private.example' },
      rawCommitter: { name: 'Jane Doe', email: 'jane.doe@private.example' },
      message: messageEndingWith(
        'Co-authored-by: Rob Roe <rob@private.example>',
        coAuthoredBy(noreplyEmail(9, 'nine')),
      ),
    }),
  ],
});

/** 300 commits by 300 different unsigned accounts, each committed by an identity GitHub could not link. */
const MANY = evaluationInput({
  opener: account(1),
  commits: Array.from({ length: 300 }, (_unused, index) =>
    commit(index + 10, {
      author: account(1000 + index),
      committer: null,
      rawCommitter: { name: `Committer ${index + 10}`, email: `c${index}@private.example` },
    }),
  ),
});

test.each([
  ['unsigned only', UNSIGNED_ONLY, 'failure-unsigned-only.md'],
  ['unlinked only', UNLINKED_ONLY, 'failure-unlinked-only.md'],
  ['unsigned and unlinked', BOTH, 'failure-both.md'],
  ['300 commits', MANY, 'failure-300-commits.md'],
] as const)('the failure report of %s is stored in a snapshot', async (_what, input, file) => {
  const { evaluation, text } = checkRunText(input);
  expect(evaluation.outcome).toBe('failure');
  await expect(text).toMatchFileSnapshot(`reporting/snapshots/${file}`);
});

test.each([
  ['unsigned only', UNSIGNED_ONLY],
  ['unlinked only', UNLINKED_ONLY],
  ['unsigned and unlinked', BOTH],
  ['300 commits', MANY],
] as const)('the report of %s prints no email address and no part of one', (_what, input) => {
  const { text } = checkRunText(input);
  expect(text).not.toMatch(PRIVATE);
  expect(unguardedMarks(text.replace(/^### .*$/gmu, ''))).toEqual([]);
});

test('unsigned only: the opener who is also a committer is one entry, and a signed author is not listed', () => {
  const { text } = checkRunText(UNSIGNED_ONLY);
  expect(text).toContain('CLA signature required: 2 unsigned\n');
  expect(text).toContain('- `octocat` (GitHub id 1): opened the PR, committer\n- `hubot` (GitHub id 2): commit author');
  expect(text).not.toContain('monalisa');
  expect(text).not.toContain('How to fix');
  expect(text).toContain('[Sign the CLA](https://cla.example.test/sign/4242?pr=7)');
});

test('unlinked only: no sign link, no Not signed section, and the fix steps are there', () => {
  const { text } = checkRunText(UNLINKED_ONLY);
  expect(text).toContain('CLA signature required: 2 unlinked\n');
  expect(text).not.toContain('Sign the CLA');
  expect(text).not.toContain('Not signed');
  expect(text).toContain('- commit `0000002`: authored as `Jane Doe` (email not linked to a GitHub account)');
  expect(text).toContain('- commit `0000003`: committed as `Pat Committer` (email not linked to a GitHub account)');
  expect(text).toContain('### How to fix');
});

test('a commit with both identities unlinked is one entry, and the co-authors who cannot be resolved are named, bots and AI never', () => {
  const { text } = checkRunText(BOTH);
  expect(text).toContain('CLA signature required: 3 unsigned, 2 unlinked\n');
  expect(text).toContain('- commit `0000003`: authored as `Jane Doe`, committed as `Jane Doe` (email');
  expect(text).toContain('### Not blocking\n\nThese do not change the result.\n\n- `Rob Roe`\n');
});

test('a commit with a maintainer override is not listed, and one line counts it', () => {
  const input = evaluationInput({
    opener: account(3),
    signatures: SIGNED,
    commits: [
      commit(2, { author: null, committer: account(3) }),
      commit(3, { author: null, committer: account(3) }),
      commit(4, { author: account(2), committer: account(3) }),
    ],
    overrides: new Map([[sha(2), 77]]),
  });
  const { text } = checkRunText(input);
  expect(text).toContain('- commit `0000003`');
  expect(text).not.toContain('- commit `0000002`');
  expect(text).toContain('1 commit with an email not linked to a GitHub account is covered by a maintainer override.');
});

test('a bot that is not allowlisted is told that it cannot sign, and the sign link is not offered for it alone', () => {
  const input = evaluationInput({
    opener: account(4, 'Bot'),
    signatures: SIGNED,
    commits: [commit(2, { author: account(4, 'Bot'), committer: account(3) })],
  });
  const { text } = checkRunText(input);
  expect(text).toContain(
    '- `dependabot[bot]` (GitHub id 4): opened the PR, commit author (a bot cannot sign; a maintainer can add it to the allowlist)',
  );
  expect(text).not.toContain('Sign the CLA');
});

test('without an active CLA the report is the one sentence, whatever the people are', () => {
  const { evaluation, text } = checkRunText(evaluationInput({ policy: null, opener: account(1) }));
  expect(evaluation.failureCodes).toEqual(['no_active_cla']);
  expect(text.trimEnd().split('\n\n')).toEqual([
    'completed failure',
    'CLA check failed',
    'This repository has no active CLA yet, so there is nothing to sign. The maintainers need to publish one.',
    'After fixing, comment `/recheck` or use Re-run. `/recheck` can be used once per minute.',
  ]);
});

test('a pull request with too many commits is told to split it, and its unsigned opener is still listed', () => {
  const { evaluation, text } = checkRunText(evaluationInput({ listing: 'exceeded', opener: account(1) }));
  expect(evaluation.failureCodes).toContain('commit_limit_exceeded');
  expect(text).toContain('CLA signature required: 1 unsigned\n');
  expect(text).toContain('Split it into smaller pull requests.');
});
