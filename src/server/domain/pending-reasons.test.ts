// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { FAILURE_CODES } from '../../shared/pr-evaluation-codes.ts';
import { type DetailsSpec, detailsOf, shaOf } from './pending-details-fixture/test-support.ts';
import { pendingReasons } from './pending-reasons.ts';

// The reasons a pull request is pending (E15-S07): one pure function of the stored details of E08-S01.

const OTHER = [{ code: 'other' }];

test('a repository with no active CLA is one no_active_cla and names none of the accounts, which are all uncovered', () => {
  const details = detailsOf({ codes: ['no_active_cla'], actors: [{ githubId: 10 }, { githubId: 11 }] });
  expect(pendingReasons(details)).toEqual([{ code: 'no_active_cla' }]);
});

test('an uncovered person is one unsigned_contributor with the numeric id, and a covered one is none', () => {
  const details = detailsOf({
    codes: ['unsigned_contributor'],
    actors: [{ githubId: 10 }, { githubId: 11, covered: true }, { githubId: 12 }],
  });
  expect(pendingReasons(details)).toEqual([
    { code: 'unsigned_contributor', githubId: 10 },
    { code: 'unsigned_contributor', githubId: 12 },
  ]);
});

test('an uncovered bot is a bot_not_allowlisted with its id, a person next to it an unsigned_contributor, and each list its own', () => {
  const details = detailsOf({
    codes: ['unsigned_contributor', 'bot_not_allowlisted'],
    actors: [{ githubId: 10, bot: true }, { githubId: 11 }, { githubId: 12, bot: true }, { githubId: 13 }],
  });
  expect(pendingReasons(details)).toEqual([
    { code: 'unsigned_contributor', githubId: 11 },
    { code: 'unsigned_contributor', githubId: 13 },
    { code: 'bot_not_allowlisted', githubId: 10 },
    { code: 'bot_not_allowlisted', githubId: 12 },
  ]);
});

test('a covered bot, an allowlisted one, is no reason, and a bot is not an unsigned contributor when only a person is missing', () => {
  const details = detailsOf({
    codes: ['unsigned_contributor'],
    actors: [{ githubId: 10, bot: true, covered: true }, { githubId: 11, bot: true }, { githubId: 12 }],
  });
  expect(pendingReasons(details)).toEqual([{ code: 'unsigned_contributor', githubId: 12 }]);
});

test('an unlinked identity is one reason for each entry with no override, with the SHA of its commit, and a waived entry is none', () => {
  const details = detailsOf({
    codes: ['unlinked_identity'],
    unlinked: [
      { sha: shaOf(1), role: 'author' },
      { sha: shaOf(1), role: 'committer' },
      { sha: shaOf(2), overrideId: 9 },
      { sha: shaOf(3), role: 'committer' },
    ],
  });
  expect(pendingReasons(details)).toEqual([
    { code: 'unlinked_identity', commitSha: shaOf(1) },
    { code: 'unlinked_identity', commitSha: shaOf(1) },
    { code: 'unlinked_identity', commitSha: shaOf(3) },
  ]);
});

test('an exceeded commit listing is one commit_limit_exceeded', () => {
  expect(pendingReasons(detailsOf({ codes: ['commit_limit_exceeded'] }))).toEqual([{ code: 'commit_limit_exceeded' }]);
});

test('the reasons come in the order of the codes of the engine whatever the order the details list them in', () => {
  const spec: DetailsSpec = {
    codes: ['commit_limit_exceeded', 'unlinked_identity', 'bot_not_allowlisted', 'unsigned_contributor'],
    actors: [{ githubId: 10, bot: true }, { githubId: 11 }],
    unlinked: [{ sha: shaOf(1) }],
  };
  expect(pendingReasons(detailsOf(spec)).map(({ code }) => code)).toEqual([
    'unsigned_contributor',
    'bot_not_allowlisted',
    'unlinked_identity',
    'commit_limit_exceeded',
  ]);
});

test.each(FAILURE_CODES)(
  'a code the engine stored always shows up, even when the lists name no account or commit for it: %s',
  (code) => {
    expect(pendingReasons(detailsOf({ codes: [code] }))).toEqual([{ code }]);
  },
);

test('details with no failure code, which no failed row should hold, are listed as other and not hidden', () => {
  expect(pendingReasons(detailsOf({ codes: [] }))).toEqual(OTHER);
});

test.each([
  ['the dead-letter write of E07-S05', { code: 'evaluation_failed' }],
  ['a code this version does not know', { code: 'something_new' }],
  ['an empty object, the details of a row still in progress', {}],
  [
    'a failure code that is not one of the engine',
    { ...detailsOf({ codes: ['unsigned_contributor'] }), failureCodes: ['made_up'] },
  ],
  ['a newer version of the shape', { ...detailsOf({ codes: ['no_active_cla'] }), version: 2 }],
  ['null', null],
  ['a string', 'unsigned_contributor'],
  ['an array', [detailsOf({ codes: ['no_active_cla'] })]],
])('stored details that are not the shape of the engine are other: %s', (_name, stored) => {
  expect(pendingReasons(stored)).toEqual(OTHER);
});

test('stored details of the engine are read as they are, through the schema', () => {
  const stored: unknown = JSON.parse(
    JSON.stringify(detailsOf({ codes: ['unsigned_contributor'], actors: [{ githubId: 77 }] })),
  );
  expect(pendingReasons(stored)).toEqual([{ code: 'unsigned_contributor', githubId: 77 }]);
});

test('the answer is a new list each time, so a caller that changes it changes nothing for the next', () => {
  const first = pendingReasons({});
  first.push({ code: 'no_active_cla' });
  expect(pendingReasons({})).toEqual(OTHER);
  const second = pendingReasons(detailsOf({ codes: [] }));
  second.push({ code: 'no_active_cla' });
  expect(pendingReasons(detailsOf({ codes: [] }))).toEqual(OTHER);
});

test('a reason holds the account id or the commit and nothing else: no name, login or email can come out of the details', () => {
  const details = detailsOf({
    codes: ['unsigned_contributor', 'unlinked_identity'],
    actors: [{ githubId: 10 }],
    unlinked: [{ sha: shaOf(5) }],
  });
  for (const reason of pendingReasons(details)) {
    expect(Object.keys(reason).every((key) => ['code', 'githubId', 'commitSha'].includes(key))).toBe(true);
  }
});
