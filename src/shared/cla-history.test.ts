// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { VERSION_PATH, VERSIONS_PATH } from './cla.ts';
import {
  versionDetailSchema,
  versionListResponseSchema,
  versionResponseSchema,
  versionSummarySchema,
} from './cla-history.ts';

// The contract of the history of a document (E12-S05): the two paths, the version of the history and the two answers.

const SUMMARY = {
  id: 7,
  major: 2,
  minor: 1,
  contentSha256: 'a'.repeat(64),
  publishedBy: { githubId: 31_001, login: 'octocat' },
  rationale: 'Clarified the patent grant',
  publishedAt: '2026-07-01T10:00:00.000Z',
  active: true,
  signatureCount: 3,
};

test('the path of one version hangs below the versions of the document and names the version by its id', () => {
  expect(VERSION_PATH).toBe('/api/installations/:installationId/documents/:documentId/versions/:versionId');
  expect(VERSION_PATH.startsWith(VERSIONS_PATH)).toBe(true);
});

test('a version of the history holds its number, hash, publisher, rationale, time, whether it is active and its signature count', () => {
  expect(versionSummarySchema.parse(SUMMARY)).toEqual(SUMMARY);
  expect(Object.keys(versionSummarySchema.shape).toSorted((a, b) => a.localeCompare(b))).toEqual([
    'active',
    'contentSha256',
    'id',
    'major',
    'minor',
    'publishedAt',
    'publishedBy',
    'rationale',
    'signatureCount',
  ]);
});

test.each([
  ['a negative signature count', { signatureCount: -1 }],
  ['a fractional signature count', { signatureCount: 1.5 }],
  ['a major of zero', { major: 0 }],
  ['a negative minor', { minor: -1 }],
  ['a hash of 63 digits', { contentSha256: 'a'.repeat(63) }],
  ['a hash in capitals', { contentSha256: 'A'.repeat(64) }],
  ['a time that is not ISO 8601', { publishedAt: 'yesterday' }],
  ['an active flag that is not a boolean', { active: 'yes' }],
  ['a publisher without an id', { publishedBy: { login: 'octocat' } }],
  ['a publisher with an id of zero', { publishedBy: { githubId: 0, login: 'octocat' } }],
  ['a rationale that is not text', { rationale: null }],
])('a version of the history with %s is not one', (_label, change) => {
  expect(versionSummarySchema.safeParse({ ...SUMMARY, ...change }).success).toBe(false);
});

test('the publisher is told by the numeric id and the login the row holds, and a login is any text', () => {
  expect(versionSummarySchema.shape.publishedBy.parse({ githubId: 5, login: 'erased-5' })).toEqual({
    githubId: 5,
    login: 'erased-5',
  });
  expect(
    versionSummarySchema.shape.publishedBy.parse({ githubId: 5, login: '<img src=x onerror=alert(1)>' }).login,
  ).toBe('<img src=x onerror=alert(1)>');
});

test('the detail adds the text and nothing else, and the text is required', () => {
  expect(versionDetailSchema.parse({ ...SUMMARY, contentMd: 'Terms\n' })).toEqual({ ...SUMMARY, contentMd: 'Terms\n' });
  expect(versionDetailSchema.safeParse(SUMMARY).success).toBe(false);
  expect(Object.keys(versionDetailSchema.shape)).toEqual([...Object.keys(versionSummarySchema.shape), 'contentMd']);
  expect(versionResponseSchema.parse({ version: { ...SUMMARY, contentMd: 'Terms\n' } }).version.contentMd).toBe(
    'Terms\n',
  );
});

test('a page of the history has the versions and a cursor that is text or null; the text of a version is not part of it', () => {
  expect(versionListResponseSchema.parse({ versions: [SUMMARY], nextCursor: 'abc' })).toEqual({
    versions: [SUMMARY],
    nextCursor: 'abc',
  });
  expect(versionListResponseSchema.parse({ versions: [], nextCursor: null }).nextCursor).toBeNull();
  expect(versionListResponseSchema.safeParse({ versions: [SUMMARY] }).success).toBe(false);
  expect(
    Object.keys(
      versionListResponseSchema.parse({ versions: [{ ...SUMMARY, contentMd: 'Terms\n' }], nextCursor: null })
        .versions[0] ?? {},
    ),
  ).not.toContain('contentMd');
});
