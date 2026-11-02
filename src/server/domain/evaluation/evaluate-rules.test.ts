// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { evaluatePullRequest } from './evaluate.ts';
import { GITHUB_WEB_FLOW_ID } from './github-identities.ts';
import {
  account,
  coAuthoredBy,
  commitFacts,
  allowlistEntry as entry,
  evaluationInput,
  membership,
  messageEndingWith,
  noreplyEmail,
  sha,
  signatureFact,
} from './test-support.ts';
import type { AdvisoryCode, CommitFacts, EvaluationInput, FailureCode } from './types.ts';

// E08-S08, mutation readiness: one row per rule, each written so that flipping the condition of that rule changes the
// answer of the row. A row names the input, the ids that must end up uncovered, the failure codes and the advisories.
// User 1 opens every pull request and has signed document 1 at major 1 (the base), unless a row says otherwise.

interface Row {
  readonly name: string;
  readonly input: EvaluationInput;
  readonly uncovered: readonly number[];
  readonly codes: readonly FailureCode[];
  readonly advisories?: readonly AdvisoryCode[];
}

const sign = (id: number, overrides: Parameters<typeof signatureFact>[2] = {}) => signatureFact(id * 10, id, overrides);
const pr = (overrides: Partial<EvaluationInput>): EvaluationInput =>
  evaluationInput({ signatures: [sign(1)], ...overrides });
const bot = (id: number) => account(id, 'Bot');
const trailer = (id: number) => coAuthoredBy(noreplyEmail(id, `pair${id}`));
const withTrailers = (n: number, ids: readonly number[]): CommitFacts =>
  commitFacts(n, { author: account(1), committer: account(1), message: messageEndingWith(...ids.map(trailer)) });
const manyIds = (count: number) => Array.from({ length: count }, (_unused, index) => 100 + index);

const signatureRows: readonly Row[] = [
  {
    name: 'major equal to the active one covers',
    input: pr({ commits: [commitFacts(2)], signatures: [sign(1), sign(2)] }),
    uncovered: [],
    codes: [],
  },
  {
    name: 'a major above the active one does not cover',
    input: pr({ commits: [commitFacts(2)], signatures: [sign(1), sign(2, { major: 2 })] }),
    uncovered: [2],
    codes: ['unsigned_contributor'],
  },
  {
    name: 'a major below the active one does not cover',
    input: pr({
      policy: { documentId: 1, activeMajor: 2 },
      commits: [commitFacts(2)],
      signatures: [sign(1, { major: 2 }), sign(2, { major: 1 })],
    }),
    uncovered: [2],
    codes: ['unsigned_contributor'],
  },
  {
    name: 'a revoked signature does not cover',
    input: pr({ commits: [commitFacts(2)], signatures: [sign(1), sign(2, { revoked: true })] }),
    uncovered: [2],
    codes: ['unsigned_contributor'],
  },
  {
    name: 'a signature for another document does not cover',
    input: pr({ commits: [commitFacts(2)], signatures: [sign(1), sign(2, { documentId: 2 })] }),
    uncovered: [2],
    codes: ['unsigned_contributor'],
  },
  {
    name: 'a signature of a bot account is ignored',
    input: pr({
      commits: [commitFacts(2, { author: bot(500), committer: bot(500) })],
      signatures: [sign(1), sign(500)],
    }),
    uncovered: [500],
    codes: ['bot_not_allowlisted'],
  },
  {
    name: 'an unsigned opener fails whatever the commits',
    input: pr({ opener: account(9), commits: [commitFacts(2)], signatures: [sign(2)] }),
    uncovered: [9],
    codes: ['unsigned_contributor'],
  },
  {
    name: 'no active CLA fails and covers nobody, even a signer',
    input: pr({ policy: null, signatures: [sign(1)] }),
    uncovered: [1],
    codes: ['no_active_cla'],
  },
];

const exemptionRows: readonly Row[] = [
  {
    name: 'a committer equal to the author is exempt',
    input: pr({ commits: [commitFacts(2, { committer: account(2) })], signatures: [sign(1), sign(2)] }),
    uncovered: [],
    codes: [],
  },
  {
    name: 'a committer other than the author is evaluated',
    input: pr({ commits: [commitFacts(2, { committer: account(3) })], signatures: [sign(1), sign(2)] }),
    uncovered: [3],
    codes: ['unsigned_contributor'],
  },
  {
    name: 'the web-flow committer is exempt',
    input: pr({
      commits: [commitFacts(2, { committer: account(GITHUB_WEB_FLOW_ID) })],
      signatures: [sign(1), sign(2)],
    }),
    uncovered: [],
    codes: [],
  },
  {
    name: 'the id just below web-flow is an ordinary committer',
    input: pr({ commits: [commitFacts(2, { committer: account(19_864_446) })], signatures: [sign(1), sign(2)] }),
    uncovered: [19_864_446],
    codes: ['unsigned_contributor'],
  },
  {
    name: 'the id just above web-flow is an ordinary committer',
    input: pr({ commits: [commitFacts(2, { committer: account(19_864_448) })], signatures: [sign(1), sign(2)] }),
    uncovered: [19_864_448],
    codes: ['unsigned_contributor'],
  },
  {
    name: 'a commit with two parents is skipped',
    input: pr({ commits: [commitFacts(3, { parents: [sha(1), sha(2)] })] }),
    uncovered: [],
    codes: [],
  },
  {
    name: 'a commit with three parents is skipped too',
    input: pr({ commits: [commitFacts(3, { parents: [sha(1), sha(2), sha(4)] })] }),
    uncovered: [],
    codes: [],
  },
  {
    name: 'a commit with one parent is read',
    input: pr({ commits: [commitFacts(3, { parents: [sha(2)] })] }),
    uncovered: [3],
    codes: ['unsigned_contributor'],
  },
  {
    name: 'a root commit with no parent is read',
    input: pr({ commits: [commitFacts(3, { parents: [] })] }),
    uncovered: [3],
    codes: ['unsigned_contributor'],
  },
  {
    name: 'the trailers of a skipped merge commit are not read',
    input: pr({
      commits: [commitFacts(3, { parents: [sha(1), sha(2)], message: messageEndingWith(trailer(40)) })],
    }),
    uncovered: [],
    codes: [],
  },
];

const allowlistRows: readonly Row[] = [
  {
    name: 'a user entry covers a person who never signed',
    input: pr({ commits: [commitFacts(2)], allowlist: [entry(1, 'user', 2)] }),
    uncovered: [],
    codes: [],
  },
  {
    name: 'a member of a listed organisation is covered',
    input: pr({
      commits: [commitFacts(2)],
      allowlist: [entry(1, 'org_members', 700)],
      orgMembers: membership([700, [2]]),
    }),
    uncovered: [],
    codes: [],
  },
  {
    name: 'an organisation with no membership fact covers nobody',
    input: pr({ commits: [commitFacts(2)], allowlist: [entry(1, 'org_members', 700)] }),
    uncovered: [2],
    codes: ['unsigned_contributor'],
  },
  {
    name: 'membership exempts the member and not the co-author of the member commit',
    input: pr({
      commits: [commitFacts(2, { message: messageEndingWith(trailer(40)) })],
      allowlist: [entry(1, 'org_members', 700)],
      orgMembers: membership([700, [2]]),
    }),
    uncovered: [40],
    codes: ['unsigned_contributor'],
  },
  {
    name: 'a bot entry covers a bot',
    input: pr({
      commits: [commitFacts(2, { author: bot(500), committer: bot(500) })],
      allowlist: [entry(1, 'bot', 500)],
    }),
    uncovered: [],
    codes: [],
  },
  {
    name: 'a user entry does not cover a bot',
    input: pr({
      commits: [commitFacts(2, { author: bot(500), committer: bot(500) })],
      allowlist: [entry(1, 'user', 500)],
    }),
    uncovered: [500],
    codes: ['bot_not_allowlisted'],
  },
  {
    name: 'an organisation entry does not cover a bot that is listed as a member',
    input: pr({
      commits: [commitFacts(2, { author: bot(500), committer: bot(500) })],
      allowlist: [entry(1, 'org_members', 700)],
      orgMembers: membership([700, [500]]),
    }),
    uncovered: [500],
    codes: ['bot_not_allowlisted'],
  },
];

const identityRows: readonly Row[] = [
  {
    name: 'an unlinked author without an override fails',
    input: pr({ commits: [commitFacts(2, { author: null, committer: null })] }),
    uncovered: [],
    codes: ['unlinked_identity'],
  },
  {
    name: 'an override in upper case matches the lower-case SHA',
    input: pr({
      commits: [commitFacts(0xab, { author: null, committer: null })],
      overrides: new Map([[sha(0xab).toUpperCase(), 5]]),
    }),
    uncovered: [],
    codes: [],
  },
  {
    name: 'an override in lower case matches a commit listed with an upper-case SHA',
    input: pr({
      commits: [{ ...commitFacts(0xab, { author: null, committer: null }), sha: sha(0xab).toUpperCase() }],
      overrides: new Map([[sha(0xab), 5]]),
    }),
    uncovered: [],
    codes: [],
  },
  {
    name: 'an override for another commit changes nothing',
    input: pr({ commits: [commitFacts(2, { author: null, committer: null })], overrides: new Map([[sha(9), 5]]) }),
    uncovered: [],
    codes: ['unlinked_identity'],
  },
  {
    name: 'an override waives the unlinked author and not the unsigned linked committer of the same commit',
    input: pr({
      commits: [commitFacts(2, { author: null, committer: account(3) })],
      overrides: new Map([[sha(2), 5]]),
    }),
    uncovered: [3],
    codes: ['unsigned_contributor'],
  },
  {
    name: 'a trailer naming an unsigned id fails the pull request',
    input: pr({ commits: [withTrailers(2, [40])] }),
    uncovered: [40],
    codes: ['unsigned_contributor'],
  },
  {
    name: 'a trailer naming a signer is covered',
    input: pr({ commits: [withTrailers(2, [40])], signatures: [sign(1), sign(40)] }),
    uncovered: [],
    codes: [],
  },
  {
    name: 'a trailer with the legacy login-only address is an advisory and blocks nothing',
    input: pr({
      commits: [
        commitFacts(2, {
          author: account(1),
          committer: account(1),
          message: messageEndingWith(coAuthoredBy('someone@users.noreply.github.com')),
        }),
      ],
    }),
    uncovered: [],
    codes: [],
    advisories: ['co_author_unresolved'],
  },
  {
    name: 'twenty trailers are all read',
    input: pr({ commits: [withTrailers(2, manyIds(20))] }),
    uncovered: manyIds(20),
    codes: ['unsigned_contributor'],
  },
  {
    name: 'the twenty-first trailer is not read and gives an advisory',
    input: pr({ commits: [withTrailers(2, manyIds(21))] }),
    uncovered: manyIds(20),
    codes: ['unsigned_contributor'],
    advisories: ['too_many_trailers'],
  },
];

const rows = [...signatureRows, ...exemptionRows, ...allowlistRows, ...identityRows];

test.each(rows)('rule: $name', ({ input, uncovered, codes, advisories = [] }) => {
  const evaluation = evaluatePullRequest(input);
  expect(evaluation.actors.filter((actor) => !actor.covered).map((actor) => actor.account.id)).toEqual(uncovered);
  expect(evaluation.failureCodes).toEqual(codes);
  expect(evaluation.advisories.map((advisory) => advisory.code)).toEqual(advisories);
  expect(evaluation.outcome).toBe(codes.length === 0 ? 'success' : 'failure');
});
