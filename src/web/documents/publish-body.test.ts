// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { publishVersionRequestSchema } from '../../shared/cla-version.ts';
import { publishBody } from './publish-body.ts';

// E18-S05: the request of a publish is made in one place, and it is a body the contract of the server accepts.

const INPUT = {
  revision: 3,
  bump: 'major',
  rationale: 'Clarified section 2',
  activeVersionId: 301,
  acknowledgeResigning: false,
} as const;

test('a publish names the draft revision, the bump, the rationale and the active version the person saw, and nothing else', () => {
  expect(publishBody(INPUT)).toEqual({
    source: { type: 'draft', revision: 3 },
    bump: 'major',
    rationale: 'Clarified section 2',
    expectedActiveVersionId: 301,
  });
});

test('the first request never carries acknowledgeResigning, so the server can ask', () => {
  expect(Object.keys(publishBody(INPUT))).not.toContain('acknowledgeResigning');
});

test('a confirmed re-signing is sent as acknowledgeResigning: true', () => {
  expect(publishBody({ ...INPUT, acknowledgeResigning: true })).toEqual({
    source: { type: 'draft', revision: 3 },
    bump: 'major',
    rationale: 'Clarified section 2',
    expectedActiveVersionId: 301,
    acknowledgeResigning: true,
  });
});

test('a document with no version is published over null', () => {
  expect(publishBody({ ...INPUT, activeVersionId: null }).expectedActiveVersionId).toBeNull();
});

test.each([
  INPUT,
  { ...INPUT, acknowledgeResigning: true },
  { ...INPUT, bump: 'minor', activeVersionId: null },
] as const)('the body %# is one the server contract accepts', (input) => {
  expect(publishVersionRequestSchema.safeParse(publishBody(input)).success).toBe(true);
});
