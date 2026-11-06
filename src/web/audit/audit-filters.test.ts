// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { filterKey, isFiltered, NO_FILTERS } from './audit-filters.ts';

// E18-S09: what narrows the audit log, and the key a component is remounted by.

test('no filter is not filtered', () => {
  expect(isFiltered(NO_FILTERS)).toBe(false);
});

test.each([
  ['an action', { action: 'signature.created' }],
  ['an actor', { actorGithubId: 4711 }],
  ['a subject type', { subjectType: 'signature' }],
  ['a subject id', { subjectId: 9 }],
  ['a start', { from: '2026-11-01T00:00:00.000Z' }],
  ['an end', { to: '2026-11-01T00:00:00.000Z' }],
] as const)('%s alone is filtered', (_what, change) => {
  expect(isFiltered({ ...NO_FILTERS, ...change })).toBe(true);
});

test('the key is the same for the same filters, and differs when any one of them differs', () => {
  const same = filterKey({ ...NO_FILTERS, actorGithubId: 4711 });
  expect(filterKey({ ...NO_FILTERS, actorGithubId: 4711 })).toBe(same);
  const others = [
    NO_FILTERS,
    { ...NO_FILTERS, action: 'signature.created' },
    { ...NO_FILTERS, actorGithubId: 4712 },
    { ...NO_FILTERS, subjectType: 'signature' },
    { ...NO_FILTERS, subjectId: 9 },
    { ...NO_FILTERS, from: '2026-11-01T00:00:00.000Z' },
    { ...NO_FILTERS, to: '2026-11-01T00:00:00.000Z' },
    { ...NO_FILTERS, subjectId: 4711 },
  ] as const;
  expect(new Set([same, ...others.map(filterKey)]).size).toBe(others.length + 1);
});
