// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  ALLOWLIST_ENTRY_PATH,
  ALLOWLIST_LOGIN_PATTERN,
  ALLOWLIST_PAGE_SIZE,
  allowlistEntryRequestSchema,
  allowlistEntryResponseSchema,
  allowlistPageSchema,
  allowlistQuerySchema,
  INSTALLATION_ALLOWLIST_PATH,
  REPOSITORY_ALLOWLIST_PATH,
  repositoryAllowlistPageSchema,
} from './allowlist.ts';

test('the paths name the installation or the repository by the row id of our tables', () => {
  expect(INSTALLATION_ALLOWLIST_PATH).toBe('/api/installations/:installationId/allowlist-entries');
  expect(REPOSITORY_ALLOWLIST_PATH).toBe('/api/repositories/:repositoryId/allowlist-entries');
  expect(ALLOWLIST_ENTRY_PATH).toBe('/api/installations/:installationId/allowlist-entries/:entryId');
});

test.each([
  ['a single letter', 'a'],
  ['a digit', '7'],
  ['a login with hyphens', 'ada-lovelace-1'],
  ['39 characters, the longest login', `a${'b'.repeat(38)}`],
  ['a bot', 'dependabot[bot]'],
  ['a bot with a hyphen', 'github-actions[bot]'],
])('%s is a login', (_label, login) => {
  expect(ALLOWLIST_LOGIN_PATTERN.test(login)).toBe(true);
});

test.each([
  ['empty', ''],
  ['a leading hyphen', '-ada'],
  ['40 characters', `a${'b'.repeat(39)}`],
  ['an underscore', 'ada_lovelace'],
  ['a dot', 'ada.lovelace'],
  ['a space', 'ada lovelace'],
  ['a slash', 'ada/lovelace'],
  ['a path walk', '../etc'],
  ['markup', '<img src=x onerror=alert(1)>'],
  ['an encoded character', 'ada%2e'],
  ['a trailing newline', 'ada\n'],
  ['bot twice', 'dependabot[bot][bot]'],
  ['a bot suffix in the middle', 'ada[bot]x'],
  ['a bare suffix', '[bot]'],
  ['a different case of the suffix', 'dependabot[BOT]'],
  ['a non-ASCII letter', 'adá'],
])('%s is not a login', (_label, login) => {
  expect(ALLOWLIST_LOGIN_PATTERN.test(login)).toBe(false);
});

test.each([
  ['a user', { kind: 'user', login: 'ada' }],
  ['a bot', { kind: 'bot', login: 'dependabot[bot]' }],
  ['the members of the organisation', { kind: 'org_members' }],
])('the body accepts %s', (_label, body) => {
  expect(allowlistEntryRequestSchema.parse(body)).toEqual(body);
});

test.each([
  ['a user without a login', { kind: 'user' }],
  ['a bot without a login', { kind: 'bot' }],
  ['members with a login', { kind: 'org_members', login: 'org-1' }],
  ['members with an id', { kind: 'org_members', githubId: 42 }],
  ['a user with an id', { kind: 'user', login: 'ada', githubId: 42 }],
  ['a user with an installation', { kind: 'user', login: 'ada', installationId: 1 }],
  ['another kind', { kind: 'team', login: 'ada' }],
  ['no kind', { login: 'ada' }],
  ['a login that is not one', { kind: 'user', login: '<b>ada</b>' }],
  ['a login that is a number', { kind: 'user', login: 42 }],
  ['text', 'ada'],
  ['nothing', undefined],
])('the body refuses %s', (_label, body) => {
  expect(allowlistEntryRequestSchema.safeParse(body).success).toBe(false);
});

const ENTRY = {
  id: 3,
  scope: 'repository',
  repositoryId: 12,
  kind: 'user',
  githubId: 4242,
  loginSnapshot: 'ada',
  createdBy: { githubId: 31_001 },
  createdAt: '2026-11-04T10:00:00.000Z',
} as const;

test('the answer is the entry, with a snapshot or none', () => {
  expect(allowlistEntryResponseSchema.parse({ entry: ENTRY })).toEqual({ entry: ENTRY });
  expect(
    allowlistEntryResponseSchema.parse({ entry: { ...ENTRY, loginSnapshot: null } }).entry.loginSnapshot,
  ).toBeNull();
});

test.each([
  ['a snapshot with markup', { loginSnapshot: '<b>ada</b>' }],
  ['a snapshot that is empty', { loginSnapshot: '' }],
  ['a scope nobody defined', { scope: 'organisation' }],
  ['a kind nobody defined', { kind: 'team' }],
  ['a GitHub id of zero', { githubId: 0 }],
  ['a repository id of zero', { repositoryId: 0 }],
  ['a time without a zone', { createdAt: '2026-11-04T10:00:00' }],
  ['no author', { createdBy: undefined }],
])('the answer refuses %s', (_label, change) => {
  expect(allowlistEntryResponseSchema.safeParse({ entry: { ...ENTRY, ...change } }).success).toBe(false);
});

test('a page holds 100 entries unless the request names a limit, and 200 at most', () => {
  expect(ALLOWLIST_PAGE_SIZE).toEqual({ default: 100, max: 200 });
});

test.each([
  ['nothing', {}, {}],
  ['a limit', { limit: '25' }, { limit: 25 }],
  ['the least limit', { limit: '1' }, { limit: 1 }],
  ['the greatest limit', { limit: '200' }, { limit: 200 }],
  ['a cursor', { cursor: 'WyJ1c2VyIl0' }, { cursor: 'WyJ1c2VyIl0' }],
  ['both', { limit: '3', cursor: 'abc' }, { limit: 3, cursor: 'abc' }],
])('the query of a list takes %s', (_label, query, parsed) => {
  expect(allowlistQuerySchema.parse(query)).toEqual(parsed);
});

test.each([
  ['a limit of 0', { limit: '0' }],
  ['a limit of 201', { limit: '201' }],
  ['a limit of 1000', { limit: '1000' }],
  ['a limit with a leading zero', { limit: '010' }],
  ['a limit with a fraction', { limit: '1.5' }],
  ['a limit with a sign', { limit: '+5' }],
  ['a limit in exponent form', { limit: '1e2' }],
  ['a limit that is not a number', { limit: 'many' }],
  ['an empty limit', { limit: '' }],
  ['an empty cursor', { cursor: '' }],
  ['a cursor of 1025 characters', { cursor: 'a'.repeat(1025) }],
  ['a parameter nobody defined', { order: 'desc' }],
])('the query of a list refuses %s', (_label, query) => {
  expect(allowlistQuerySchema.safeParse(query).success).toBe(false);
});

const LISTED = { ...ENTRY, createdBy: { githubId: 31_001, login: 'grace-hopper' }, readOnly: false };

test('a page of the installation holds the entries with who made them and where the next page starts, or null', () => {
  const page = { entries: [LISTED], nextCursor: null };
  expect(allowlistPageSchema.parse(page)).toEqual(page);
  expect(allowlistPageSchema.parse({ entries: [], nextCursor: 'abc' }).nextCursor).toBe('abc');
});

test('a page of a repository holds its own entries, the inherited ones and where the next page starts, or null', () => {
  const page = {
    own: [LISTED],
    inherited: [{ ...LISTED, id: 4, scope: 'installation', readOnly: true }],
    nextCursor: null,
  };
  expect(repositoryAllowlistPageSchema.parse(page)).toEqual(page);
});

test.each([
  ['no author login', { createdBy: { githubId: 31_001 } }],
  ['an author login that is not text', { createdBy: { githubId: 31_001, login: 7 } }],
  ['no read-only flag', { readOnly: undefined }],
  ['a read-only flag that is text', { readOnly: 'yes' }],
])('a page refuses an entry with %s', (_label, change) => {
  expect(allowlistPageSchema.safeParse({ entries: [{ ...LISTED, ...change }], nextCursor: null }).success).toBe(false);
});

test.each([
  ['no next cursor', { entries: [] }],
  ['a next cursor that is a number', { entries: [], nextCursor: 4 }],
  ['no entries', { nextCursor: null }],
])('a page of the installation refuses %s', (_label, page) => {
  expect(allowlistPageSchema.safeParse(page).success).toBe(false);
});
