// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  ALLOWLIST_LOGIN_PATTERN,
  allowlistEntryRequestSchema,
  allowlistEntryResponseSchema,
  INSTALLATION_ALLOWLIST_PATH,
  REPOSITORY_ALLOWLIST_PATH,
} from './allowlist.ts';

test('the paths name the installation or the repository by the row id of our tables', () => {
  expect(INSTALLATION_ALLOWLIST_PATH).toBe('/api/installations/:installationId/allowlist-entries');
  expect(REPOSITORY_ALLOWLIST_PATH).toBe('/api/repositories/:repositoryId/allowlist-entries');
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
