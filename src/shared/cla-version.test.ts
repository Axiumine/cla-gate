// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { MAX_REVISION, VERSIONS_PATH } from './cla.ts';
import {
  normaliseRationale,
  publishVersionRequestSchema,
  publishVersionResponseSchema,
  RATIONALE_MAX_CODE_POINTS,
} from './cla-version.ts';

// The contract of publishing a version (E12-S04): the path, the rationale and the two bodies.

test('the path of the versions hangs below the document, next to its draft', () => {
  expect(VERSIONS_PATH).toBe('/api/installations/:installationId/documents/:documentId/versions');
  expect(RATIONALE_MAX_CODE_POINTS).toBe(2000);
});

test.each([
  ['a sentence', 'Clarified the patent grant', 'Clarified the patent grant'],
  ['white space at both ends', '  \t\n Fixed a typo \n\t ', 'Fixed a typo'],
  ['inner white space is kept', 'a  b\t\tc', 'a  b\t\tc'],
  ['CRLF and CR become LF', 'one\r\ntwo\rthree', 'one\ntwo\nthree'],
  ['several lines', 'First\n\nSecond', 'First\n\nSecond'],
  ['one character', 'x', 'x'],
  [
    'hostile text is stored as typed',
    '<script>alert(1)</script> =HYPERLINK("x") @everyone',
    '<script>alert(1)</script> =HYPERLINK("x") @everyone',
  ],
  ['a bidirectional override is stored as typed', 'a\u202Eb', 'a\u202Eb'],
  ['no Unicode normalisation', 'é', 'é'],
  ['a line separator is stored as typed', 'a b', 'a b'],
])('the rationale %s is stored as expected', (_label, raw, stored) => {
  expect(normaliseRationale(raw)).toBe(stored);
});

test.each([
  ['an empty string', ''],
  ['white space only', ' \t\r\n '],
  ['NUL', 'a\0b'],
  ['a bell', 'a\u0007b'],
  ['escape', '\u001Bx'],
  ['DEL', 'a\u007Fb'],
  ['a C1 control', 'a\u0085b'],
  ['a vertical tab in the middle', 'a\u000Bb'],
  ['a vertical tab at the start, which trimming would hide', '\u000Bx'],
  ['a form feed at the end, which trimming would hide', 'x\u000C'],
  ['a lone high surrogate', 'a\uD800b'],
  ['a lone low surrogate', 'a\uDC00b'],
])('%s is not a rationale', (_label, raw) => {
  expect(normaliseRationale(raw)).toBeNull();
});

test('the limit is 2 000 code points once trimmed: 2 000 pass, 2 001 do not, whatever the width of the characters', () => {
  expect(normaliseRationale('a'.repeat(2000))).toBe('a'.repeat(2000));
  expect(normaliseRationale('a'.repeat(2001))).toBeNull();
  expect(normaliseRationale(`  ${'a'.repeat(2000)}  `)).toBe('a'.repeat(2000));
  const emoji = '\u{1F600}';
  expect(normaliseRationale(emoji.repeat(2000))).toBe(emoji.repeat(2000));
  expect(normaliseRationale(emoji.repeat(2001))).toBeNull();
  expect(normaliseRationale(emoji.repeat(4000))).toBeNull();
  expect(normaliseRationale('a'.repeat(4000))).toBeNull();
  expect(normaliseRationale('a'.repeat(100_000))).toBeNull();
});

const BODY = {
  source: { type: 'draft', revision: 3 },
  bump: 'minor',
  rationale: 'Fixed a typo',
  expectedActiveVersionId: 12,
} as const;

test.each([
  ['a minor bump', BODY],
  ['a major bump', { ...BODY, bump: 'major' }],
  ['the first version', { ...BODY, bump: 'major', expectedActiveVersionId: null }],
  ['the confirmation of the re-signing', { ...BODY, bump: 'major', acknowledgeResigning: true }],
  ['a confirmation that is false', { ...BODY, acknowledgeResigning: false }],
  ['the largest revision the column holds', { ...BODY, source: { type: 'draft', revision: MAX_REVISION } }],
  ['a rationale the service will refuse', { ...BODY, rationale: '' }],
])('a publish body with %s is accepted', (_label, body) => {
  expect(publishVersionRequestSchema.safeParse(body).success).toBe(true);
});

test.each([
  ['an unknown key', { ...BODY, installationId: 5 }],
  ['an unknown key in the source', { ...BODY, source: { type: 'draft', revision: 3, versionId: 4 } }],
  ['no source', { bump: 'minor', rationale: 'x', expectedActiveVersionId: null }],
  ['no bump', { source: BODY.source, rationale: 'x', expectedActiveVersionId: null }],
  ['no rationale', { source: BODY.source, bump: 'minor', expectedActiveVersionId: null }],
  [
    'no expected version, which is required even for the first version',
    { source: BODY.source, bump: 'minor', rationale: 'x' },
  ],
  ['another bump', { ...BODY, bump: 'patch' }],
  ['a bump in capitals', { ...BODY, bump: 'MAJOR' }],
  ['another source type', { ...BODY, source: { type: 'upload', revision: 3 } }],
  [
    'the source of a later story, which this one does not accept',
    { ...BODY, source: { type: 'version', versionId: 4 } },
  ],
  ['a source without a type', { ...BODY, source: { revision: 3 } }],
  ['a source that is not an object', { ...BODY, source: 3 }],
  ['a revision of zero', { ...BODY, source: { type: 'draft', revision: 0 } }],
  ['a revision the column cannot hold', { ...BODY, source: { type: 'draft', revision: MAX_REVISION + 1 } }],
  ['a revision as text', { ...BODY, source: { type: 'draft', revision: '3' } }],
  ['a null revision', { ...BODY, source: { type: 'draft', revision: null } }],
  ['an expected version of zero', { ...BODY, expectedActiveVersionId: 0 }],
  ['an expected version as text', { ...BODY, expectedActiveVersionId: '12' }],
  ['a fractional expected version', { ...BODY, expectedActiveVersionId: 1.5 }],
  ['a rationale that is not a string', { ...BODY, rationale: 5 }],
  ['a confirmation as text', { ...BODY, acknowledgeResigning: 'true' }],
  ['a confirmation of null', { ...BODY, acknowledgeResigning: null }],
])('a publish body with %s is refused', (_label, body) => {
  expect(publishVersionRequestSchema.safeParse(body).success).toBe(false);
});

const VERSION = {
  id: 5,
  major: 2,
  minor: 0,
  contentSha256: 'a'.repeat(64),
  publishedAt: '2026-11-03T10:00:00.000Z',
};

test('the answer holds the version, whether signers sign again, and how many it affects', () => {
  const answer = { version: VERSION, requiresResigning: true, affectedSignatures: 3 };
  expect(publishVersionResponseSchema.parse(answer)).toEqual(answer);
  expect(publishVersionResponseSchema.safeParse({ ...answer, affectedSignatures: -1 }).success).toBe(false);
  expect(publishVersionResponseSchema.safeParse({ ...answer, requiresResigning: 'yes' }).success).toBe(false);
  expect(publishVersionResponseSchema.safeParse({ version: VERSION, requiresResigning: false }).success).toBe(false);
  expect(publishVersionResponseSchema.safeParse({ ...answer, version: { ...VERSION, id: 0 } }).success).toBe(false);
});
