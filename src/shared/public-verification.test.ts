// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  BADGE_SNIPPET_PATH,
  badgeSnippetResponseSchema,
  badgeSnippetRoute,
  PUBLIC_API_PREFIX,
  PUBLIC_BADGE_PATH,
  PUBLIC_LOGIN_PATTERN,
  PUBLIC_SIGNER_BADGE_PATH,
  PUBLIC_SIGNER_PATH,
  PUBLIC_VERIFICATION_PATH,
  publicRepositoryParamsSchema,
  publicSignerParamsSchema,
  publicSignerResponseSchema,
  publicVerificationRequestSchema,
  publicVerificationResponseSchema,
  publicVerificationRoute,
} from './public-verification.ts';

test('the opt-in names the installation and the repository by their row ids, and the public call the repository by its GitHub id and the login', () => {
  expect(PUBLIC_VERIFICATION_PATH).toBe(
    '/api/installations/:installationId/repositories/:repositoryId/public-verification',
  );
  expect(PUBLIC_SIGNER_PATH).toBe('/api/public/repos/:githubRepoId/signers/:login');
  expect(PUBLIC_SIGNER_PATH.startsWith(PUBLIC_API_PREFIX)).toBe(true);
  expect(PUBLIC_API_PREFIX).toBe('/api/public/');
});

test.each([[true], [false]])('the opt-in body { enabled: %s } is read', (enabled) => {
  expect(publicVerificationRequestSchema.parse({ enabled })).toEqual({ enabled });
});

test.each([
  ['no body', undefined],
  ['null', null],
  ['an empty object', {}],
  ['a text for the flag', { enabled: 'true' }],
  ['a number for the flag', { enabled: 1 }],
  ['a key nobody defined next to the flag', { enabled: true, installationId: 1 }],
  ['a list', [true]],
])('%s is not an opt-in body', (_label, body) => {
  expect(publicVerificationRequestSchema.safeParse(body).success).toBe(false);
});

test('the opt-in answer says whether the check is on and whether the call changed it, and nothing else', () => {
  expect(publicVerificationResponseSchema.parse({ enabled: true, changed: false, extra: 1 })).toEqual({
    enabled: true,
    changed: false,
  });
  expect(publicVerificationResponseSchema.safeParse({ enabled: true }).success).toBe(false);
});

test.each([
  ['a'],
  ['A'],
  ['0'],
  ['octocat'],
  ['OctoCat'],
  ['a-b'],
  ['a-b-c'],
  ['0-9'],
  ['login-31004'],
  ['a'.repeat(39)],
])('the login %s has the shape of a GitHub login', (login) => {
  expect(PUBLIC_LOGIN_PATTERN.test(login)).toBe(true);
});

test.each([
  ['nothing', ''],
  ['a hyphen alone', '-'],
  ['a leading hyphen', '-ab'],
  ['a trailing hyphen', 'ab-'],
  ['two hyphens in a row', 'a--b'],
  ['three hyphens in a row', 'a---b'],
  ['40 characters', 'a'.repeat(40)],
  ['an underscore', 'a_b'],
  ['a dot', 'a.b'],
  ['a space', 'a b'],
  ['a slash', 'a/b'],
  ['the suffix of a bot', 'dependabot[bot]'],
  ['a letter with an accent', 'café'],
  ['a letter of another script', 'aа'],
  ['a trailing line feed', 'octocat\n'],
  ['a leading line feed', '\noctocat'],
  ['a null byte', 'octo\u0000cat'],
  ['markup', '<script>'],
  ['a statement', "x'; drop table users;--"],
])('%s is not the shape of a GitHub login', (_label, login) => {
  expect(PUBLIC_LOGIN_PATTERN.test(login)).toBe(false);
});

test.each([
  ['1', 1],
  ['9000', 9000],
  ['9007199254740991', 9_007_199_254_740_991],
])('the repository id %s is read as a number', (githubRepoId, expected) => {
  expect(publicSignerParamsSchema.parse({ githubRepoId, login: 'octocat' })).toEqual({
    githubRepoId: expected,
    login: 'octocat',
  });
});

test.each([
  ['zero', '0'],
  ['a negative number', '-1'],
  ['a plus sign', '+1'],
  ['a leading zero', '01'],
  ['a fraction', '1.5'],
  ['an exponent', '1e3'],
  ['hexadecimal', '0x10'],
  ['a letter', 'a'],
  ['nothing', ''],
  ['white space around', ' 1'],
  ['more than a safe integer', '9007199254740992'],
  ['seventeen digits', '10000000000000000'],
  ['a trailing line feed', '1\n'],
])('the repository id of %s is not read', (_label, githubRepoId) => {
  expect(publicSignerParamsSchema.safeParse({ githubRepoId, login: 'octocat' }).success).toBe(false);
});

test('a path that lacks a parameter, or whose login is not a login, is not read', () => {
  expect(publicSignerParamsSchema.safeParse({ githubRepoId: '1' }).success).toBe(false);
  expect(publicSignerParamsSchema.safeParse({ login: 'octocat' }).success).toBe(false);
  expect(publicSignerParamsSchema.safeParse({ githubRepoId: '1', login: 'a--b' }).success).toBe(false);
});

test('the public answer is exactly { signed }: it carries nothing else and takes nothing else', () => {
  expect(publicSignerResponseSchema.parse({ signed: true })).toEqual({ signed: true });
  expect(publicSignerResponseSchema.safeParse({ signed: true, name: 'Ada' }).success).toBe(false);
  expect(publicSignerResponseSchema.safeParse({}).success).toBe(false);
  expect(publicSignerResponseSchema.safeParse({ signed: 'yes' }).success).toBe(false);
});

test('the badges are two more files under the public prefix, and the snippet is a maintainer call named by row ids', () => {
  expect(PUBLIC_BADGE_PATH).toBe('/api/public/repos/:githubRepoId/badge.svg');
  expect(PUBLIC_SIGNER_BADGE_PATH).toBe('/api/public/repos/:githubRepoId/signers/:login/badge.svg');
  expect(PUBLIC_BADGE_PATH.startsWith(PUBLIC_API_PREFIX)).toBe(true);
  expect(PUBLIC_SIGNER_BADGE_PATH.startsWith(PUBLIC_API_PREFIX)).toBe(true);
  expect(BADGE_SNIPPET_PATH).toBe('/api/installations/:installationId/repositories/:repositoryId/badge-snippet');
});

test('the project badge reads the repository id as the signer call does, and takes nothing else from the path', () => {
  expect(publicRepositoryParamsSchema.parse({ githubRepoId: '9000', login: 'ignored' })).toEqual({
    githubRepoId: 9000,
  });
  for (const githubRepoId of ['0', '-1', '01', '1.5', '1e3', 'a', '', '9007199254740992']) {
    expect(publicRepositoryParamsSchema.safeParse({ githubRepoId }).success).toBe(false);
  }
  expect(publicRepositoryParamsSchema.safeParse({}).success).toBe(false);
});

test('the snippet is exactly { markdown, html }: nothing else comes with it and nothing is left out', () => {
  expect(badgeSnippetResponseSchema.parse({ markdown: 'm', html: 'h' })).toEqual({ markdown: 'm', html: 'h' });
  expect(badgeSnippetResponseSchema.safeParse({ markdown: 'm', html: 'h', login: 'octocat' }).success).toBe(false);
  expect(badgeSnippetResponseSchema.safeParse({ markdown: 'm' }).success).toBe(false);
  expect(badgeSnippetResponseSchema.safeParse({ markdown: 1, html: 'h' }).success).toBe(false);
});

test('the descriptors of the settings screen name the paths, the methods and the answers of the two maintainer calls', () => {
  expect([publicVerificationRoute.name, badgeSnippetRoute.name]).toEqual([
    `PUT ${PUBLIC_VERIFICATION_PATH}`,
    `GET ${BADGE_SNIPPET_PATH}`,
  ]);
  expect(publicVerificationRoute.body).toBe(publicVerificationRequestSchema);
  expect(publicVerificationRoute.responses[200]).toBe(publicVerificationResponseSchema);
  expect(badgeSnippetRoute.responses[200]).toBe(badgeSnippetResponseSchema);
  const ids = { installationId: 2, repositoryId: 3 };
  expect(publicVerificationRoute.params.parse(ids)).toEqual(ids);
  expect(badgeSnippetRoute.params.safeParse({ installationId: 0, repositoryId: 3 }).success).toBe(false);
  expect(badgeSnippetRoute.params.safeParse({ installationId: 2, repositoryId: 1.5 }).success).toBe(false);
});
