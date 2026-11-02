// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { FAILURE_CODES, ROLES } from './pr-evaluation-codes.ts';
import { PrEvaluationDetails, parseStoredDetails, STORED_LIMITS } from './pr-evaluation-details.ts';
import { storedDetailsSample } from './test-support.ts';

// E08-S08: the stored value is bounded by its schema, not by a size we hope for. Every list has a maximum, `omitted`
// says what was left out, and the largest value the schema accepts is smaller than 256 KiB.

const LIMIT = 256 * 1024;
const MAX_ID = Number.MAX_SAFE_INTEGER;
const times = <T>(count: number, item: T): T[] => Array.from({ length: count }, () => item);
const accepted = (value: unknown): boolean => parseStoredDetails(value).ok;

const LARGEST_ACTOR = {
  githubId: MAX_ID,
  roles: [...ROLES],
  covered: true,
  basis: { kind: 'signature', signatureId: MAX_ID, versionId: MAX_ID, major: MAX_ID },
} as const;
const LARGEST_FINDING = { sha: 'f'.repeat(64), role: 'committer', overrideId: MAX_ID } as const;
const LARGEST_ADVISORY = { code: 'too_many_trailers', sha: 'f'.repeat(64) } as const;

const largestValue = () => ({
  version: 1,
  outcome: 'failure',
  failureCodes: [...FAILURE_CODES],
  documentId: MAX_ID,
  activeMajor: MAX_ID,
  commitCount: MAX_ID,
  mergeCommitsSkipped: MAX_ID,
  listing: 'complete',
  actors: times(STORED_LIMITS.actors, LARGEST_ACTOR),
  unlinked: times(STORED_LIMITS.unlinked, LARGEST_FINDING),
  advisories: times(STORED_LIMITS.advisories, LARGEST_ADVISORY),
  omitted: { actors: MAX_ID, unlinked: MAX_ID, advisories: MAX_ID },
});

test('the limits are 500 actors, 500 unlinked findings and 500 advisories', () => {
  expect(STORED_LIMITS).toEqual({ actors: 500, unlinked: 500, advisories: 500 });
});

test('the largest value the schema accepts (every list full, every id at its maximum) is under 256 KiB', () => {
  const largest = largestValue();
  expect(PrEvaluationDetails.safeParse(largest).success).toBe(true);
  expect(new TextEncoder().encode(JSON.stringify(largest)).length).toBeLessThan(LIMIT);
});

test.each([
  ['actors', 'actors', STORED_LIMITS.actors, LARGEST_ACTOR],
  ['unlinked', 'unlinked', STORED_LIMITS.unlinked, LARGEST_FINDING],
  ['advisories', 'advisories', STORED_LIMITS.advisories, LARGEST_ADVISORY],
] as const)('a full %s list is accepted and one entry more is refused', (_label, key, limit, entry) => {
  expect(accepted(largestValue())).toBe(true);
  expect(accepted({ ...largestValue(), [key]: times(limit + 1, entry) })).toBe(false);
});

test('more failure codes than the vocabulary has are refused, repeats included', () => {
  expect(accepted({ ...largestValue(), failureCodes: [...FAILURE_CODES, 'no_active_cla'] })).toBe(false);
});

test('an actor with more roles than the vocabulary has is refused, repeats included', () => {
  const crowded = { ...LARGEST_ACTOR, roles: [...ROLES, 'opener'] };
  expect(accepted({ ...largestValue(), actors: [crowded] })).toBe(false);
});

test('a value that omits nothing has no omitted field, and the sample is valid without it', () => {
  expect('omitted' in storedDetailsSample()).toBe(false);
  expect(accepted(storedDetailsSample())).toBe(true);
});

test.each([
  ['counts of each list', { actors: 1501, unlinked: 0, advisories: 3 }],
  ['zeros', { actors: 0, unlinked: 0, advisories: 0 }],
])('omitted with %s is accepted and read back', (_label, omitted) => {
  const value = { ...storedDetailsSample(), omitted };
  expect(parseStoredDetails(value)).toEqual({ ok: true, details: value });
});

test.each([
  ['a missing count', { actors: 1, unlinked: 0 }],
  ['a negative count', { actors: -1, unlinked: 0, advisories: 0 }],
  ['a fractional count', { actors: 1.5, unlinked: 0, advisories: 0 }],
  ['a count as a string', { actors: '1', unlinked: 0, advisories: 0 }],
  ['an extra key', { actors: 1, unlinked: 0, advisories: 0, login: 'octocat' }],
  ['null', null],
  ['a number', 3],
])('omitted with %s is refused', (_label, omitted) => {
  expect(accepted({ ...storedDetailsSample(), omitted })).toBe(false);
});
