// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { LookupBudget, PUBLIC_LOOKUPS_PER_MINUTE } from './public-lookup-budget.ts';
import { FakeClock } from './test-support.ts';

// What anonymous callers may spend of an installation's GitHub budget (E22-S02): thirty uncached lookups a minute, counted per
// installation in windows of a minute that start with the first lookup after the last window ended.

const START = '2026-11-01T10:00:00Z';
const FIRST = parseGithubId(5000);
const SECOND = parseGithubId(5001);

test('the budget is thirty lookups a minute', () => {
  expect(PUBLIC_LOOKUPS_PER_MINUTE).toBe(30);
});

test('the first lookups of a window are free of waiting and the one after the budget is told to wait for the rest of the window', () => {
  const clock = new FakeClock(START);
  const budget = new LookupBudget(clock);
  expect(Array.from({ length: 30 }, () => budget.take(FIRST))).toEqual(Array.from({ length: 30 }, () => 0));
  clock.advance(12_500);
  expect(budget.take(FIRST)).toBe(48);
  expect(budget.take(FIRST)).toBe(48);
});

test('a window ends exactly a minute after its first lookup, and the next lookup starts a new one with the full budget', () => {
  const clock = new FakeClock(START);
  const budget = new LookupBudget(clock, { perMinute: 2 });
  budget.take(FIRST);
  budget.take(FIRST);
  clock.advance(59_999);
  expect(budget.take(FIRST)).toBe(1);
  clock.advance(1);
  expect([budget.take(FIRST), budget.take(FIRST), budget.take(FIRST)]).toEqual([0, 0, 60]);
});

test('a wait is never less than a second, even at the last millisecond of the window', () => {
  const clock = new FakeClock(START);
  const budget = new LookupBudget(clock, { perMinute: 1 });
  budget.take(FIRST);
  clock.advance(59_999);
  expect(budget.take(FIRST)).toBe(1);
});

test('each installation has a window of its own', () => {
  const budget = new LookupBudget(new FakeClock(START), { perMinute: 1 });
  expect([budget.take(FIRST), budget.take(SECOND), budget.take(FIRST), budget.take(SECOND)]).toEqual([0, 0, 60, 60]);
});

test('only the most recent windows are kept: past the limit the oldest installation starts afresh', () => {
  const budget = new LookupBudget(new FakeClock(START), { perMinute: 1, maxWindows: 2 });
  const third = parseGithubId(5002);
  budget.take(FIRST);
  budget.take(SECOND);
  budget.take(third);
  expect(budget.take(SECOND)).toBe(60);
  expect(budget.take(third)).toBe(60);
  expect(budget.take(FIRST)).toBe(0);
});
