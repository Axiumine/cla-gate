// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { EXPIRE_IN_SECONDS, QUEUE_DEFINITIONS, QUEUES } from './queues.ts';

// The queue definitions (E07-S01, E07-S02): which policy each queue is created with.

test('the queues are the names of the definitions, in their order, each once', () => {
  expect(QUEUES).toEqual(QUEUE_DEFINITIONS.map(({ name }) => name));
  expect(new Set(QUEUES).size).toBe(QUEUES.length);
});

test('evaluate-pr is the one singleton queue: any number wait, one per key runs. The others are standard', () => {
  expect(QUEUE_DEFINITIONS.filter(({ policy }) => policy === 'singleton')).toEqual([
    { name: 'evaluate-pr', policy: 'singleton' },
  ]);
  expect(QUEUE_DEFINITIONS.filter(({ policy }) => policy !== 'singleton')).toHaveLength(QUEUES.length - 1);
  expect(QUEUE_DEFINITIONS.filter(({ policy }) => policy === 'standard')).toHaveLength(QUEUES.length - 1);
});

test('a job that a dead worker holds is taken back after 300 seconds', () => {
  expect(EXPIRE_IN_SECONDS).toBe(300);
});
