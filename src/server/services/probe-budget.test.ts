// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { PROBE_BUDGETS, ProbeBudget, ProbeBudgetExhaustedError } from './probe-budget.ts';

test('the budgets are 100 for the installation list, 50 for the repository list and 10 for the denial path', () => {
  expect(PROBE_BUDGETS).toStrictEqual({ installationList: 100, repositoryList: 50, denial: 10 });
});

test('each spend takes one probe, and the count never goes below zero', () => {
  const budget = new ProbeBudget(2);
  expect(budget.remaining).toBe(2);
  budget.spend();
  expect(budget.remaining).toBe(1);
  budget.spend();
  expect(budget.remaining).toBe(0);
  expect(() => {
    budget.spend();
  }).toThrow(ProbeBudgetExhaustedError);
  expect(budget.remaining).toBe(0);
});

test('a budget of zero is empty from the start', () => {
  const budget = new ProbeBudget(0);
  expect(budget.remaining).toBe(0);
  expect(() => {
    budget.spend();
  }).toThrow('the probe budget of this request is used up');
});

test('two budgets count separately: one request cannot spend the probes of another', () => {
  const first = new ProbeBudget(3);
  const second = new ProbeBudget(3);
  first.spend();
  first.spend();
  expect([first.remaining, second.remaining]).toEqual([1, 3]);
});

test.each([
  ['a negative number', -1],
  ['a fraction', 1.5],
  ['not a number', Number.NaN],
  ['infinity', Number.POSITIVE_INFINITY],
  ['a number past the safe integers', 2 ** 53],
])('%s is not a budget', (_name, limit) => {
  expect(() => new ProbeBudget(limit)).toThrow(RangeError);
});
