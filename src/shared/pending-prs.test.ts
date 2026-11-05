// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { PENDING_PRS_PATH, PENDING_REASON_CODES, pendingPrsPageSchema } from './pending-prs.ts';

// The contract of the pending pull requests (E15-S07): the path, the closed list of reasons and the shape of a page.

const SHA = 'a'.repeat(40);

/** An item of a page with `reasons`; every other field is as the server sends it. */
const itemWith = (reasons: readonly object[]) => ({
  evaluationId: 1,
  repository: { id: 2, fullName: 'org/repo' },
  prNumber: 3,
  headSha: SHA,
  evaluatedAt: '2026-10-01T10:00:00.000Z',
  checkRunId: null,
  reasons,
});

const pageWith = (...items: readonly object[]) => ({ items, nextCursor: null, truncated: false });

const accepted = (value: unknown): boolean => pendingPrsPageSchema.safeParse(value).success;

test('the route is GET /api/installations/:installationId/pending-prs', () => {
  expect(PENDING_PRS_PATH).toBe('/api/installations/:installationId/pending-prs');
});

test('the reasons are the five failure codes of the engine in their order, and other', () => {
  expect(PENDING_REASON_CODES).toEqual([
    'no_active_cla',
    'unsigned_contributor',
    'bot_not_allowlisted',
    'unlinked_identity',
    'commit_limit_exceeded',
    'other',
  ]);
});

test('a page with every kind of reason is accepted, and a reason is the code alone where nothing else applies', () => {
  const page = pageWith(
    itemWith([
      { code: 'no_active_cla' },
      { code: 'unsigned_contributor', githubId: 5, login: 'ada' },
      { code: 'bot_not_allowlisted', githubId: 6, login: null },
      { code: 'unlinked_identity', commitSha: SHA },
      { code: 'commit_limit_exceeded' },
      { code: 'other' },
    ]),
  );
  expect(pendingPrsPageSchema.parse(page)).toEqual(page);
  expect(accepted({ items: [], nextCursor: 'abc', truncated: true })).toBe(true);
});

test.each([
  ['a login without a githubId', { code: 'unsigned_contributor', login: 'ada' }],
  ['a githubId without a login', { code: 'unsigned_contributor', githubId: 5 }],
  ['a code that is not in the list', { code: 'evaluation_failed' }],
  ['a githubId of 0', { code: 'unsigned_contributor', githubId: 0, login: null }],
  ['a commitSha in capitals', { code: 'unlinked_identity', commitSha: 'A'.repeat(40) }],
  ['a commitSha that is too short', { code: 'unlinked_identity', commitSha: 'a'.repeat(39) }],
  ['a field nobody defined', { code: 'other', email: 'a@example.test' }],
])('a reason with %s is refused', (_name, reason) => {
  expect(accepted(pageWith(itemWith([reason])))).toBe(false);
});

test('an item with no reason is refused: a pending pull request always says why', () => {
  expect(accepted(pageWith(itemWith([])))).toBe(false);
});

test.each([
  ['a missing item field', { ...itemWith([{ code: 'other' }]), headSha: undefined }],
  ['an extra item field', { ...itemWith([{ code: 'other' }]), author: 'ada' }],
  ['a pull request number of 0', { ...itemWith([{ code: 'other' }]), prNumber: 0 }],
  ['an evaluated time that is not UTC', { ...itemWith([{ code: 'other' }]), evaluatedAt: '2026-10-01T10:00:00+02:00' }],
  ['a Check Run id of 0', { ...itemWith([{ code: 'other' }]), checkRunId: 0 }],
])('an item with %s is refused', (_name, item) => {
  expect(accepted(pageWith(item))).toBe(false);
});

test('a page needs its cursor and its truncated flag, and allows nothing else', () => {
  expect(accepted({ items: [], truncated: false })).toBe(false);
  expect(accepted({ items: [], nextCursor: null })).toBe(false);
  expect(accepted({ items: [], nextCursor: null, truncated: false, total: 0 })).toBe(false);
});
