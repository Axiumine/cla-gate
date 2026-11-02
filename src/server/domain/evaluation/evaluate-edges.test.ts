// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { evaluatePullRequest } from './evaluate.ts';
import {
  account,
  allowlistEntry,
  commitFacts,
  evaluationInput,
  membership,
  sha,
  signatureFact,
} from './test-support.ts';
import { ACCOUNT_TYPES, type CommitFacts, type EvaluationInput } from './types.ts';

// E08-S08: the engine never throws on a well-typed input. These inputs are all well typed, and some are odd: nothing at
// all, ids at both ends of the safe range, empty strings where text is allowed, huge text, a pull request of 2,000
// commits, and every account type as the opener. Whatever the input, the outcome and the failure codes still agree.

const MAX = Number.MAX_SAFE_INTEGER;
const blankIdentity = { name: '', email: '' };
const blankCommit: CommitFacts = {
  sha: '',
  parents: [''],
  author: account(1),
  committer: account(MAX),
  message: '',
  rawAuthor: blankIdentity,
  rawCommitter: blankIdentity,
};

const inputs: readonly (readonly [string, EvaluationInput])[] = [
  ['nothing at all and no CLA', evaluationInput({ policy: null })],
  ['nothing at all', evaluationInput()],
  ['an exceeded listing with nothing else', evaluationInput({ listing: 'exceeded' })],
  ['an exceeded listing and no CLA', evaluationInput({ listing: 'exceeded', policy: null })],
  [
    'ids at both ends of the safe range',
    evaluationInput({
      opener: account(MAX),
      commits: [commitFacts(2, { author: account(1), committer: account(MAX) })],
      signatures: [signatureFact(MAX, MAX, { documentId: MAX, versionId: MAX, major: MAX })],
      policy: { documentId: MAX, activeMajor: MAX },
      allowlist: [allowlistEntry(MAX, 'org_members', MAX), allowlistEntry(1, 'user', 1)],
      orgMembers: membership([MAX, [MAX, 1]]),
      overrides: new Map([[sha(2), MAX]]),
    }),
  ],
  [
    'empty strings wherever text is allowed',
    evaluationInput({ commits: [blankCommit], overrides: new Map([['', 1]]) }),
  ],
  [
    'a commit message of a million characters',
    evaluationInput({ commits: [commitFacts(2, { message: 'a\n'.repeat(500_000) })] }),
  ],
  [
    'a message of blank lines and carriage returns',
    evaluationInput({ commits: [commitFacts(2, { message: '\r\n\r\n\r\n \t\r' })] }),
  ],
  [
    'an organisation with an empty member set',
    evaluationInput({
      commits: [commitFacts(2)],
      allowlist: [allowlistEntry(1, 'org_members', 500)],
      orgMembers: membership([500, []]),
    }),
  ],
  ['a commit that is its own parent', evaluationInput({ commits: [commitFacts(2, { parents: [sha(2)] })] })],
  [
    '2,000 commits by one person',
    evaluationInput({
      commits: Array.from({ length: 2000 }, (_unused, index) =>
        commitFacts(index + 10, { author: account(2), committer: account(2) }),
      ),
    }),
  ],
  ...ACCOUNT_TYPES.map((type): readonly [string, EvaluationInput] => [
    `a ${type} account as the opener`,
    evaluationInput({ opener: account(1, type) }),
  ]),
];

test.each(inputs)('the engine evaluates %s without throwing, and the outcome agrees with the codes', (_name, input) => {
  const evaluation = evaluatePullRequest(input);
  expect(evaluation.outcome === 'success').toBe(evaluation.failureCodes.length === 0);
  expect(evaluation.actors.length).toBeGreaterThan(0);
});
