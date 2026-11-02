// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseStoredDetails } from '../../../shared/pr-evaluation-details.ts';
import { evaluatePullRequest } from './evaluate.ts';
import type { Evaluation } from './evaluation-types.ts';
import { toStoredDetails } from './stored-details.ts';
import {
  account,
  allowlistEntry,
  coAuthoredBy,
  commitFacts,
  evaluationInput,
  fiftyCommitInput,
  messageEndingWith,
  noreplyEmail,
  sha,
  signatureFact,
} from './test-support.ts';
import type { CoveringBasis, EvaluationInput } from './types.ts';

// E08-S08: the evaluation as the stored `details`. It holds numeric ids and codes only; the display-only identities of
// the input never reach it.

const signed = [signatureFact(10, 1), signatureFact(20, 2)];
const unlinked = commitFacts(3, { author: null, committer: null });

const inputs: readonly (readonly [string, EvaluationInput])[] = [
  ['everyone signed', evaluationInput({ commits: [commitFacts(2)], signatures: signed })],
  ['the 50-commit fixture', fiftyCommitInput()],
  ['an exceeded listing', evaluationInput({ listing: 'exceeded', signatures: signed })],
  ['no active CLA', evaluationInput({ policy: null, commits: [commitFacts(2), unlinked] })],
  [
    'an overridden unlinked author',
    evaluationInput({ commits: [unlinked], signatures: signed, overrides: new Map([[sha(3), 9]]) }),
  ],
  ['an empty pull request', evaluationInput({ opener: account(1, 'Mannequin') })],
];

test.each(inputs)(
  'the stored details of %s are accepted by the stored-details schema and read back equal',
  (_name, input) => {
    const details = toStoredDetails(evaluatePullRequest(input));
    expect(parseStoredDetails(details)).toEqual({ ok: true, details });
  },
);

test('the stored details carry the verdict field by field', () => {
  const details = toStoredDetails(
    evaluatePullRequest(
      evaluationInput({
        policy: { documentId: 7, activeMajor: 3 },
        commits: [commitFacts(2), commitFacts(3, { parents: [sha(1), sha(2)] }), commitFacts(4, { author: null })],
        signatures: [signatureFact(10, 1, { documentId: 7, major: 3 })],
        allowlist: [allowlistEntry(5, 'user', 2, 'installation')],
        overrides: new Map([[sha(4), 12]]),
      }),
    ),
  );
  expect(details).toEqual({
    version: 1,
    outcome: 'failure',
    failureCodes: ['unsigned_contributor'],
    documentId: 7,
    activeMajor: 3,
    commitCount: 3,
    mergeCommitsSkipped: 1,
    listing: 'complete',
    actors: [
      {
        githubId: 1,
        roles: ['opener'],
        covered: true,
        basis: { kind: 'signature', signatureId: 10, versionId: 1010, major: 3 },
      },
      {
        githubId: 2,
        roles: ['author'],
        covered: true,
        basis: { kind: 'allowlist', entryId: 5, entryKind: 'user', scope: 'installation' },
      },
      { githubId: 4, roles: ['committer'], covered: false, basis: null },
    ],
    unlinked: [{ sha: sha(4), role: 'author', overrideId: 12 }],
    advisories: [],
  });
});

test('without a CLA the stored document and major are both null', () => {
  const details = toStoredDetails(evaluatePullRequest(evaluationInput({ policy: null })));
  expect(details).toMatchObject({
    outcome: 'failure',
    failureCodes: ['no_active_cla'],
    documentId: null,
    activeMajor: null,
  });
});

test('the stored lists are copies: changing them does not change the evaluation', () => {
  const evaluation = evaluatePullRequest(evaluationInput({ commits: [commitFacts(2)], signatures: signed }));
  const details = toStoredDetails(evaluation);
  details.actors[0]?.roles.push('author');
  details.failureCodes.push('no_active_cla');
  expect(evaluation.actors[0]?.roles).toEqual(['opener']);
  expect(evaluation.failureCodes).toEqual([]);
});

test('a field the in-memory basis or actor carries beyond the schema is not stored', () => {
  const signature = { kind: 'signature', signatureId: 1, versionId: 2, major: 3, login: 'leaky-login' } as const;
  const listed = {
    kind: 'allowlist',
    entryId: 4,
    entryKind: 'user',
    scope: 'repository',
    email: 'leaky@example.org',
  } as const;
  const base = evaluatePullRequest(evaluationInput({ commits: [commitFacts(2)], signatures: signed }));
  const actor = (id: number, basis: CoveringBasis) => ({
    ...base.actors[0],
    account: account(id),
    name: 'leaky name',
    covered: true,
    basis,
    roles: ['author' as const],
    shas: [],
  });
  const evaluation: Evaluation = { ...base, actors: [actor(1, signature), actor(2, listed)] };
  const text = JSON.stringify(toStoredDetails(evaluation));
  for (const fragment of ['leaky-login', 'leaky@example.org', 'leaky name']) {
    expect(text).not.toContain(fragment);
  }
  expect(parseStoredDetails(JSON.parse(text)).ok).toBe(true);
});

// Personal data. Distinctive strings go into every field of the input that holds text: the app slug of the accounts, the raw
// name and email of unlinked commits, and the message with its trailers (a name, a login in a noreply address, a markdown
// payload, an @mention, an issue reference and an unresolvable address). None may be in the stored details.

const NAME = 'Zebulon Quixote';
const EMAIL = 'zebulon.quixote@secret.example';
const LOGIN = 'zq-login';
const MARKDOWN = '[pwn](https://evil.example/zq) **bold** @everyone #1234';
const SLUG = 'secret-app-slug';

function hostileInput(): EvaluationInput {
  const raw = { name: `${NAME} ${MARKDOWN}`, email: EMAIL };
  const message = messageEndingWith(
    coAuthoredBy(noreplyEmail(40, LOGIN), `${NAME} ${MARKDOWN}`),
    coAuthoredBy(EMAIL, `Quixote Jr ${MARKDOWN}`),
  );
  return evaluationInput({
    opener: { id: 1, type: 'User', appSlug: SLUG },
    commits: [
      commitFacts(2, {
        author: { id: 2, type: 'Bot', appSlug: SLUG },
        committer: account(3),
        message,
        rawAuthor: raw,
        rawCommitter: raw,
      }),
      commitFacts(4, { author: null, committer: null, message, rawAuthor: raw, rawCommitter: raw }),
    ],
    signatures: signed,
    overrides: new Map([[sha(4), 31]]),
  });
}

test('the personal strings put into every input field reach the in-memory result, so the next test is a real one', () => {
  const text = JSON.stringify(evaluatePullRequest(hostileInput()));
  expect(text).toContain(EMAIL);
  expect(text).toContain(SLUG);
  expect(text).toContain('evil.example');
});

test.each([
  NAME,
  'Zebulon',
  'Quixote',
  EMAIL,
  'secret.example',
  LOGIN,
  MARKDOWN,
  'evil.example',
  '@everyone',
  '#1234',
  SLUG,
])('the stored details contain no trace of %s', (fragment) => {
  const evaluation = evaluatePullRequest(hostileInput());
  expect(JSON.stringify(toStoredDetails(evaluation)).toLowerCase()).not.toContain(fragment.toLowerCase());
  expect(evaluation.failureCodes.length).toBeGreaterThan(0);
});
