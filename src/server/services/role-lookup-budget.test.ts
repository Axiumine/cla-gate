// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { createViewerLookupBudget, INSTALLATION_LIST_LOOKUPS, RoleLookupThrottledError } from './role-lookup-budget.ts';
import { FakeClock } from './test-support.ts';

// What one person may cost the GitHub budgets of the tenants (E11-S04): 30 uncached lookups in a sliding minute.

const ALICE = parseGithubId(501);
const BOB = parseGithubId(502);

function setup() {
  const clock = new FakeClock('2026-11-02T10:00:00.000Z');
  const budget = createViewerLookupBudget(clock);
  /** How many lookups of the person are let through before the first refusal, up to `attempts`. */
  const spendUpTo = (viewer: typeof ALICE, attempts: number): number => {
    for (let spent = 0; spent < attempts; spent += 1) {
      try {
        budget.spend(viewer);
      } catch (error) {
        expect(error).toBeInstanceOf(RoleLookupThrottledError);
        return spent;
      }
    }
    return attempts;
  };
  return { clock, budget, spendUpTo };
}

test('30 lookups in a minute are let through and the 31st is refused', () => {
  const { spendUpTo } = setup();
  expect(spendUpTo(ALICE, 100)).toBe(30);
});

test('the list of installations may make 300 lookups a minute, a budget of its own that the same function makes', () => {
  expect(INSTALLATION_LIST_LOOKUPS).toBe(300);
  const budget = createViewerLookupBudget(new FakeClock('2026-11-02T10:00:00.000Z'), INSTALLATION_LIST_LOOKUPS);
  for (let lookup = 0; lookup < 300; lookup += 1) {
    budget.spend(ALICE);
  }
  expect(() => {
    budget.spend(ALICE);
  }).toThrow(RoleLookupThrottledError);
});

test('the refusal says when to come back: the whole seconds until the oldest of the 30 leaves the minute', () => {
  const { clock, budget, spendUpTo } = setup();
  spendUpTo(ALICE, 30);
  expect(() => {
    budget.spend(ALICE);
  }).toThrow(expect.objectContaining({ retryAfterSeconds: 60 }));
  clock.advance(20_500);
  expect(() => {
    budget.spend(ALICE);
  }).toThrow(expect.objectContaining({ retryAfterSeconds: 40 }));
});

test('the minute slides: one lookup is free again when the oldest is 60 s old, not before', () => {
  const { clock, budget, spendUpTo } = setup();
  spendUpTo(ALICE, 1);
  clock.advance(10_000);
  spendUpTo(ALICE, 29);
  clock.advance(49_999);
  expect(spendUpTo(ALICE, 5)).toBe(0);
  clock.advance(1);
  expect(spendUpTo(ALICE, 5)).toBe(1);
  clock.advance(9999);
  expect(() => {
    budget.spend(ALICE);
  }).toThrow(RoleLookupThrottledError);
  clock.advance(1);
  expect(spendUpTo(ALICE, 100)).toBe(29);
});

test('lookups spread over the minute count together', () => {
  const { clock, spendUpTo } = setup();
  for (let step = 0; step < 6; step += 1) {
    expect(spendUpTo(ALICE, 5)).toBe(5);
    clock.advance(5000);
  }
  expect(spendUpTo(ALICE, 5)).toBe(0);
  clock.advance(30_000);
  expect(spendUpTo(ALICE, 30)).toBe(5);
});

test('a refused lookup is not counted: asking again and again does not push the end of the wait away', () => {
  const { clock, budget, spendUpTo } = setup();
  spendUpTo(ALICE, 30);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    expect(() => {
      budget.spend(ALICE);
    }).toThrow(RoleLookupThrottledError);
  }
  clock.advance(60_000);
  expect(spendUpTo(ALICE, 100)).toBe(30);
});

test('each person has a budget of their own', () => {
  const { spendUpTo } = setup();
  expect(spendUpTo(ALICE, 100)).toBe(30);
  expect(spendUpTo(BOB, 100)).toBe(30);
});

test('the refusal has a fixed message that names the wait and nothing of the person', () => {
  const { budget, spendUpTo } = setup();
  spendUpTo(ALICE, 30);
  const error = (() => {
    try {
      budget.spend(ALICE);
    } catch (caught) {
      return caught;
    }
    return undefined;
  })();
  expect(error).toBeInstanceOf(RoleLookupThrottledError);
  expect(error).toMatchObject({
    name: 'RoleLookupThrottledError',
    message: 'too many uncached role lookups: retry after 60 s',
  });
  expect(JSON.stringify(error)).not.toContain('501');
});
