// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { claDraftSchema, draftResponseSchema, saveDraftRequestSchema, savedDraftResponseSchema } from './cla.ts';

// The contract of the draft routes (E12-S03): the body of a save and the two answers.

test.each([
  ['no draft yet', { contentMd: 'Terms\n', expectedRevision: null }],
  ['the first revision', { contentMd: 'Terms\n', expectedRevision: 1 }],
  ['the largest revision the column holds', { contentMd: 'Terms\n', expectedRevision: 2_147_483_647 }],
  ['a text the service will refuse', { contentMd: '', expectedRevision: null }],
])('a save with %s is accepted', (_label, body) => {
  expect(saveDraftRequestSchema.safeParse(body).success).toBe(true);
});

test.each([
  ['no revision key', { contentMd: 'Terms\n' }],
  ['no text', { expectedRevision: null }],
  ['an unknown key', { contentMd: 'Terms\n', expectedRevision: null, rationale: 'x' }],
  ['a revision of zero', { contentMd: 'Terms\n', expectedRevision: 0 }],
  ['a negative revision', { contentMd: 'Terms\n', expectedRevision: -1 }],
  ['a revision the column cannot hold', { contentMd: 'Terms\n', expectedRevision: 2_147_483_648 }],
  ['a fractional revision', { contentMd: 'Terms\n', expectedRevision: 1.5 }],
  ['a revision as text', { contentMd: 'Terms\n', expectedRevision: '1' }],
  ['a text that is not a string', { contentMd: 5, expectedRevision: null }],
  ['a null text', { contentMd: null, expectedRevision: null }],
])('a save with %s is refused', (_label, body) => {
  expect(saveDraftRequestSchema.safeParse(body).success).toBe(false);
});

const DRAFT = { contentMd: 'Terms\n', revision: 3, updatedAt: '2026-11-03T10:00:00.000Z' };

test('the answer of a read holds the draft with its text, or null', () => {
  expect(draftResponseSchema.parse({ draft: DRAFT })).toEqual({ draft: DRAFT });
  expect(draftResponseSchema.parse({ draft: null })).toEqual({ draft: null });
  expect(draftResponseSchema.safeParse({}).success).toBe(false);
  expect(claDraftSchema.safeParse({ ...DRAFT, revision: 0 }).success).toBe(false);
  expect(claDraftSchema.safeParse({ ...DRAFT, updatedAt: 'yesterday' }).success).toBe(false);
});

test('the answer of a save holds the revision and the time and never the text', () => {
  expect(savedDraftResponseSchema.parse({ draft: { revision: 4, updatedAt: DRAFT.updatedAt } })).toEqual({
    draft: { revision: 4, updatedAt: DRAFT.updatedAt },
  });
  expect(
    savedDraftResponseSchema.parse({ draft: { revision: 4, updatedAt: DRAFT.updatedAt, contentMd: 'x' } }),
  ).toEqual({
    draft: { revision: 4, updatedAt: DRAFT.updatedAt },
  });
});
