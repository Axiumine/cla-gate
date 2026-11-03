// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  evaluationKey,
  isStale,
  MAX_SWEPT_PULLS,
  needsSweepEvaluation,
  STALE_AFTER_SECONDS,
  SWEEP_EVALUATION_WINDOW_SECONDS,
  SWEEP_INSTALLATION_WINDOW_SECONDS,
  SWEEP_INTERVALS,
  SWEEP_PAGE_SIZE,
} from './sweep.ts';

// The pure rules of the sweep (E07-S08).

// 2026-11-02T12:00:00Z, in milliseconds since the epoch: a domain test names an instant by its number, as the domain reads one
const NOW = 1_793_620_800_000;
const MINUTE = 60_000;

test('the numbers of the epic are spelled out, so that changing one has to change this test', () => {
  expect(SWEEP_INTERVALS).toEqual([0, 5, 10, 15, 20, 30, 60]);
  expect(MAX_SWEPT_PULLS).toBe(1000);
  expect(SWEEP_PAGE_SIZE).toBe(100);
  expect(MAX_SWEPT_PULLS / SWEEP_PAGE_SIZE).toBe(10);
  expect(STALE_AFTER_SECONDS).toBe(1800);
  expect(SWEEP_EVALUATION_WINDOW_SECONDS).toBe(300);
  expect(SWEEP_INSTALLATION_WINDOW_SECONDS).toBe(60);
});

test('every interval but 0 divides an hour into whole parts, so the cron of it repeats evenly', () => {
  for (const minutes of SWEEP_INTERVALS.filter((interval) => interval !== 0)) {
    expect(60 % minutes).toBe(0);
  }
});

test.each([
  ['a row 29 minutes old is not stale', 29 * MINUTE, false],
  ['a row exactly 30 minutes old is not stale yet', 30 * MINUTE, false],
  ['a row 30 minutes and a millisecond old is stale', 30 * MINUTE + 1, true],
  ['a row an hour old is stale', 60 * MINUTE, true],
  ['a row from the future (a clock that moved back) is not stale', -5 * MINUTE, false],
])('%s', (_name, age, stale) => {
  expect(isStale(NOW - age, NOW)).toBe(stale);
});

test('a head SHA nobody evaluated needs an evaluation: the delivery was missed', () => {
  expect(needsSweepEvaluation(undefined, NOW)).toBe(true);
});

test.each([['success'], ['failure']] as const)('a final result (%s) is never repeated, however old it is', (result) => {
  expect(needsSweepEvaluation({ result, updatedAtMs: NOW }, NOW)).toBe(false);
  expect(needsSweepEvaluation({ result, updatedAtMs: NOW - 365 * 24 * 60 * MINUTE }, NOW)).toBe(false);
});

test('a cancelled evaluation has no verdict and needs one, however recent it is', () => {
  expect(needsSweepEvaluation({ result: 'cancelled', updatedAtMs: NOW }, NOW)).toBe(true);
});

test('an evaluation in progress needs one only when it is stale: a younger one is a job that is running or waiting to retry', () => {
  expect(needsSweepEvaluation({ result: 'in_progress', updatedAtMs: NOW - 5 * MINUTE }, NOW)).toBe(false);
  expect(needsSweepEvaluation({ result: 'in_progress', updatedAtMs: NOW - 30 * MINUTE }, NOW)).toBe(false);
  expect(needsSweepEvaluation({ result: 'in_progress', updatedAtMs: NOW - 31 * MINUTE }, NOW)).toBe(true);
});

test('the key of an evaluation names the pull request and the head SHA, so two head SHAs of one pull request are two keys', () => {
  expect(evaluationKey(7, 'a'.repeat(40))).toBe(`7@${'a'.repeat(40)}`);
  expect(evaluationKey(7, 'b'.repeat(40))).not.toBe(evaluationKey(7, 'a'.repeat(40)));
  expect(evaluationKey(8, 'a'.repeat(40))).not.toBe(evaluationKey(7, 'a'.repeat(40)));
});
