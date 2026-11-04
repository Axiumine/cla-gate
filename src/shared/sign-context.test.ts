// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  prNumberSchema,
  SIGN_BLOCKED_REASONS,
  SIGN_STATES,
  type SignContextResponse,
  signContextParamsSchema,
  signContextResponseSchema,
  signContextRoute,
} from './sign-context.ts';

// E13-S02: the contract of the sign page context. The example below is the body of the story.

const EXAMPLE = {
  repository: { githubRepoId: 123, fullName: 'acme/widgets', accountLogin: 'acme' },
  document: { id: 7, name: 'Individual CLA' },
  version: {
    id: 31,
    major: 2,
    minor: 0,
    contentMd: '...',
    contentSha256: 'a'.repeat(64),
    rationale: 'Clarified the patent grant',
    publishedAt: '2026-11-01T10:00:00.000Z',
  },
  consent: { id: 'individual-v1', text: '...' },
  emails: [{ email: 'ada@example.org', primary: true }],
  viewer: { githubId: 1234, login: 'ada' },
  pr: 45,
  prUrl: 'https://github.com/acme/widgets/pull/45',
  state: 'ready',
  signature: null,
  revoked: null,
  canSign: true,
  blockedReason: null,
} satisfies Record<keyof SignContextResponse, unknown>;

test('the route is GET /api/sign/:githubRepoId, with the repository id as its one parameter and the context as its answer', () => {
  expect(signContextRoute.name).toBe('GET /api/sign/:githubRepoId');
  expect(Object.keys(signContextRoute.params.shape)).toEqual(['githubRepoId']);
  expect(signContextRoute.responses[200]).toBe(signContextResponseSchema);
});

test('the example of the story is a valid answer', () => {
  expect(signContextResponseSchema.parse(EXAMPLE)).toEqual(EXAMPLE);
});

test.each([
  ['one', 1],
  ['a large id', 9_007_199_254_740_991],
])('the repository id is a positive integer: %s is one', (_what, githubRepoId) => {
  expect(signContextParamsSchema.safeParse({ githubRepoId }).success).toBe(true);
});

test.each([
  ['zero', 0],
  ['negative', -1],
  ['a decimal', 1.5],
  ['text', '12'],
  ['beyond a safe integer', Number.MAX_SAFE_INTEGER + 2],
  ['not a number', Number.NaN],
  ['missing', undefined],
])('the repository id is a positive integer: %s is not one', (_what, githubRepoId) => {
  expect(signContextParamsSchema.safeParse({ githubRepoId }).success).toBe(false);
});

test.each([
  ['no pr', {}, true],
  ['pr 1', { pr: 1 }, true],
  ['the largest pr', { pr: 2_147_483_647 }, true],
  ['pr 0', { pr: 0 }, false],
  ['one more than the largest', { pr: 2_147_483_648 }, false],
  ['a decimal', { pr: 1.5 }, false],
  ['text', { pr: '1' }, false],
  ['another key', { pr: 1, x: 1 }, false],
])('the query string: %s', (_what, query, valid) => {
  expect(signContextRoute.query.safeParse(query).success).toBe(valid);
});

test('a pull request number is an integer from 1 to 2147483647', () => {
  expect([0, 1, 2_147_483_647, 2_147_483_648].map((pr) => prNumberSchema.safeParse(pr).success)).toEqual([
    false,
    true,
    true,
    false,
  ]);
});

test('the three states and the one reason that blocks are the words of the story', () => {
  expect(SIGN_STATES).toEqual(['ready', 'already_signed', 'resign_required']);
  expect(SIGN_BLOCKED_REASONS).toEqual(['no_verified_email']);
});

test.each([
  [
    'already_signed with a signature',
    { state: 'already_signed', signature: { id: 5, major: 2, minor: 1, signedAt: '2026-11-01T10:00:00.000Z' } },
  ],
  [
    'ready with a revoked signature',
    { revoked: { major: 1, signedAt: '2026-10-01T10:00:00.000Z', revokedAt: '2026-10-02T10:00:00.000Z' } },
  ],
  ['a signer who cannot sign', { emails: [], canSign: false, blockedReason: 'no_verified_email' }],
  ['no pull request', { pr: null, prUrl: null }],
])('the answer may be %s', (_what, changes) => {
  expect(signContextResponseSchema.safeParse({ ...EXAMPLE, ...changes }).success).toBe(true);
});

test.each([
  ['a state that does not exist', { state: 'signed' }],
  ['a reason that does not exist', { blockedReason: 'no_name' }],
  [
    'a hash that is not 64 lower case hex characters',
    { version: { ...EXAMPLE.version, contentSha256: 'A'.repeat(64) } },
  ],
  ['a time without the Z', { version: { ...EXAMPLE.version, publishedAt: '2026-11-01T10:00:00.000+01:00' } }],
  ['a login id that is not positive', { viewer: { githubId: 0, login: 'ada' } }],
  ['a pull request number of 0', { pr: 0 }],
  ['an empty consent text', { consent: { id: 'individual-v1', text: '' } }],
  ['a field the story does not have', { extra: 1 }],
  [
    'a field a signature must not carry',
    { signature: { id: 5, major: 2, minor: 1, signedAt: '2026-11-01T10:00:00.000Z', revokedBy: 3 } },
  ],
  [
    'a revoked entry with a reason',
    {
      revoked: {
        major: 1,
        signedAt: '2026-10-01T10:00:00.000Z',
        revokedAt: '2026-10-02T10:00:00.000Z',
        reason: 'other',
      },
    },
  ],
  ['an address entry with another key', { emails: [{ email: 'ada@example.org', primary: true, verified: true }] }],
])('the answer cannot carry %s', (_what, changes) => {
  expect(signContextResponseSchema.safeParse({ ...EXAMPLE, ...changes }).success).toBe(false);
});
