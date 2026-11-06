// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import type { RepositorySweep } from './sweep-repository.ts';
import { addSettled, emptyTotals, type Settled } from './sweep-totals.ts';

// The totals the sweep of an installation logs (E07-S08): one count per outcome of each repository, added up, never taken away. The
// values below are all different, so a total that took the count of another field, or counted in the wrong direction, shows.

const swept = (counts: Partial<RepositorySweep>): Settled => ({
  kind: 'swept',
  sweep: {
    listed: 0,
    truncated: false,
    queued: 0,
    alreadyQueued: 0,
    deduplicated: 0,
    closed: 0,
    superseded: 0,
    markedClosed: 0,
    markedOpen: 0,
    ...counts,
  },
});

const ZERO = {
  repositories: 0,
  listed: 0,
  truncated: 0,
  queued: 0,
  alreadyQueued: 0,
  deduplicated: 0,
  closed: 0,
  superseded: 0,
  markedClosed: 0,
  markedOpen: 0,
  unreachable: 0,
  failed: 0,
};

test('the totals start at zero, and every call of emptyTotals gives totals of its own', () => {
  expect(emptyTotals()).toEqual(ZERO);
  const first = emptyTotals();
  first.failed = 4;
  expect(emptyTotals()).toEqual(ZERO);
});

test('a repository that failed counts as one repository and one failure, however many fail, and adds nothing else', () => {
  const totals = emptyTotals();
  addSettled(totals, { kind: 'failed' });
  expect(totals).toEqual({ ...ZERO, repositories: 1, failed: 1 });
  addSettled(totals, { kind: 'failed' });
  addSettled(totals, { kind: 'failed' });
  expect(totals).toEqual({ ...ZERO, repositories: 3, failed: 3 });
});

test('a repository GitHub did not show counts as one repository and one unreachable, however many there are, and adds nothing else', () => {
  const totals = emptyTotals();
  addSettled(totals, { kind: 'unreachable' });
  expect(totals).toEqual({ ...ZERO, repositories: 1, unreachable: 1 });
  addSettled(totals, { kind: 'unreachable' });
  addSettled(totals, { kind: 'unreachable' });
  addSettled(totals, { kind: 'unreachable' });
  expect(totals).toEqual({ ...ZERO, repositories: 4, unreachable: 4 });
});

const FIRST = {
  listed: 3,
  truncated: true,
  queued: 5,
  alreadyQueued: 7,
  deduplicated: 11,
  closed: 13,
  superseded: 17,
  markedClosed: 19,
  markedOpen: 23,
};

const SECOND = {
  listed: 29,
  truncated: false,
  queued: 31,
  alreadyQueued: 37,
  deduplicated: 41,
  closed: 43,
  superseded: 47,
  markedClosed: 53,
  markedOpen: 59,
};

test('the counts of a swept repository are added field by field, and a truncated listing counts once', () => {
  const totals = emptyTotals();
  addSettled(totals, swept(FIRST));
  expect(totals).toEqual({ ...ZERO, ...FIRST, repositories: 1, truncated: 1 });
});

test('the counts of several swept repositories are added up, not taken away, each field to its own total', () => {
  const totals = emptyTotals();
  addSettled(totals, swept(FIRST));
  addSettled(totals, swept(SECOND));
  addSettled(totals, swept({ listed: 1, truncated: true, deduplicated: 2, superseded: 3 }));
  expect(totals).toEqual({
    ...ZERO,
    repositories: 3,
    listed: 33,
    truncated: 2,
    queued: 36,
    alreadyQueued: 44,
    deduplicated: 54,
    closed: 56,
    superseded: 67,
    markedClosed: 72,
    markedOpen: 82,
  });
});

test('failed, unreachable and swept repositories in any order add up each to its own total', () => {
  const totals = emptyTotals();
  const run: Settled[] = [
    { kind: 'failed' },
    swept({ listed: 2, superseded: 1, deduplicated: 4 }),
    { kind: 'unreachable' },
    { kind: 'failed' },
    swept({ listed: 5, superseded: 2, deduplicated: 1 }),
    { kind: 'unreachable' },
    { kind: 'unreachable' },
  ];
  for (const settled of run) {
    addSettled(totals, settled);
  }
  expect(totals).toEqual({
    ...ZERO,
    repositories: 7,
    listed: 7,
    superseded: 3,
    deduplicated: 5,
    unreachable: 3,
    failed: 2,
  });
});
