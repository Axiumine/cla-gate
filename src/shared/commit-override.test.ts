// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  COMMIT_OVERRIDES_PATH,
  commitOverrideRequestSchema,
  commitOverrideResponseSchema,
  normaliseCommitSha,
} from './commit-override.ts';

// E15-S05: the contract of recording a per-commit override. A commit id is a full one, 40 or 64 hexadecimal characters, and it is
// stored in lower case.

const SHA_1 = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const SHA_256 = '0123456789abcdef'.repeat(4);

test('the route is POST /api/repositories/:repositoryId/commit-overrides', () => {
  expect(COMMIT_OVERRIDES_PATH).toBe('/api/repositories/:repositoryId/commit-overrides');
});

test.each([
  ['a SHA-1 id in lower case', SHA_1, SHA_1],
  ['a SHA-1 id in upper case', SHA_1.toUpperCase(), SHA_1],
  ['a SHA-1 id in mixed case', 'A1b2C3d4E5f60718293a4B5c6D7e8F9012345678', SHA_1],
  ['a SHA-256 id in lower case', SHA_256, SHA_256],
  ['a SHA-256 id in upper case', SHA_256.toUpperCase(), SHA_256],
])('%s is recorded in lower case', (_label, typed, stored) => {
  expect(normaliseCommitSha(typed)).toBe(stored);
});

test.each([
  ['an abbreviated id', SHA_1.slice(0, 7)],
  ['an id of 39 characters', SHA_1.slice(0, 39)],
  ['an id of 41 characters', `${SHA_1}0`],
  ['an id of 63 characters', SHA_256.slice(0, 63)],
  ['an id of 65 characters', `${SHA_256}0`],
  ['an id of 50 characters, between the two lengths', 'a'.repeat(50)],
  ['a branch name', 'main'],
  ['an empty string', ''],
  ['an id with a space around it', ` ${SHA_1}`],
  ['an id with a line feed after it', `${SHA_1}\n`],
  ['an id with a character that is not hexadecimal', `${SHA_1.slice(0, 39)}g`],
  ['an id with a full-width letter', `${SHA_1.slice(0, 39)}ａ`],
  ['an id with a Kelvin sign', `${SHA_1.slice(0, 39)}K`],
  ['a revision expression', `${SHA_1}~1`],
])('%s is not a commit id', (_label, typed) => {
  expect(normaliseCommitSha(typed)).toBeNull();
});

test('the body names the commit and the reason and nothing else; the content of either is judged by the server, not by the schema', () => {
  const body = { commitSha: SHA_1, reason: 'The author email is not linked.' };
  expect(commitOverrideRequestSchema.parse(body)).toEqual(body);
  expect(commitOverrideRequestSchema.safeParse({ commitSha: 'abc', reason: '' }).success).toBe(true);
  for (const wrong of [
    {},
    { commitSha: SHA_1 },
    { reason: 'x' },
    { ...body, installationId: 1 },
    { commitSha: 7, reason: 'x' },
    { commitSha: SHA_1, reason: null },
    undefined,
    [body],
  ]) {
    expect(commitOverrideRequestSchema.safeParse(wrong).success).toBe(false);
  }
});

test('the answer holds the override with its author by numeric id and its instant in UTC; a key, a SHA in upper case or an offset is refused', () => {
  const answer = {
    override: {
      id: 31,
      repositoryId: 4,
      commitSha: SHA_1,
      reason: '<b>reason</b>\n=1+1',
      createdBy: { githubId: 4711, login: 'maintainer' },
      createdAt: '2026-11-05T10:00:00.123Z',
    },
  };
  expect(commitOverrideResponseSchema.parse(answer)).toEqual(answer);
  const refused = [
    { override: { ...answer.override, extra: 1 } },
    { override: { ...answer.override, commitSha: SHA_1.toUpperCase() } },
    { override: { ...answer.override, reason: '' } },
    { override: { ...answer.override, createdAt: '2026-11-05T10:00:00+01:00' } },
    { override: { ...answer.override, createdBy: { githubId: 0, login: 'x' } } },
    { ...answer, extra: 1 },
  ];
  for (const wrong of refused) {
    expect(commitOverrideResponseSchema.safeParse(wrong).success).toBe(false);
  }
});
