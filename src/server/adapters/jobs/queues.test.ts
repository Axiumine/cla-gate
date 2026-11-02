// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { RETRY_LIMIT } from '../../domain/job-retry.ts';
import {
  DEAD_LETTER_QUEUE,
  DEFINITIONS_IN_CREATION_ORDER,
  QUEUE_DEFINITIONS,
  QUEUES,
  queueSettings,
  SCHEDULER_QUEUE,
  schedulerQueueSettings,
} from './queues.ts';
import { EXPECTED_BOUNDS } from './test-support.ts';

// The queue definitions (E07-S01, E07-S02): which policy each queue is created with.

test('the queues are the names of the definitions, in their order, each once', () => {
  expect(QUEUES).toEqual(QUEUE_DEFINITIONS.map(({ name }) => name));
  expect(new Set(QUEUES).size).toBe(QUEUES.length);
});

test('evaluate-pr is the one singleton queue (any number wait, one per key runs) and sweep the one exclusive queue (E07-S08). The others are standard', () => {
  expect(QUEUE_DEFINITIONS.filter(({ policy }) => policy === 'singleton')).toEqual([
    { name: 'evaluate-pr', policy: 'singleton' },
  ]);
  expect(QUEUE_DEFINITIONS.filter(({ policy }) => policy === 'exclusive')).toEqual([
    { name: 'sweep', policy: 'exclusive' },
  ]);
  expect(QUEUE_DEFINITIONS.filter(({ policy }) => policy === 'standard')).toHaveLength(QUEUES.length - 2);
});

test("pg-boss's queue of scheduled occurrences is not one of ours: no entry of QUEUES, the bounds of the others and no dead-letter queue (E07-S08)", () => {
  expect(SCHEDULER_QUEUE).toBe('__pgboss__send-it');
  expect(QUEUES).not.toContain(SCHEDULER_QUEUE);
  expect(schedulerQueueSettings()).toEqual({ policy: 'standard', ...EXPECTED_BOUNDS });
  expect(schedulerQueueSettings()).not.toHaveProperty('deadLetter');
});

test('a job that always fails runs six times: one run and five retries, 30 seconds apart at first and doubling (E07-S05)', () => {
  expect(RETRY_LIMIT).toBe(5);
  expect(queueSettings({ name: 'sweep', policy: 'exclusive' })).toMatchObject(EXPECTED_BOUNDS);
});

test('the dead-letter queue is job-dead-letter, one of the queues', () => {
  expect(DEAD_LETTER_QUEUE).toBe('job-dead-letter');
  expect(QUEUES).toContain(DEAD_LETTER_QUEUE);
});

test.each(QUEUE_DEFINITIONS.filter(({ name }) => name !== 'job-dead-letter'))(
  '$name has its policy, the bounds and job-dead-letter as its dead-letter queue',
  (definition) => {
    expect(queueSettings(definition)).toEqual({
      policy: definition.policy,
      ...EXPECTED_BOUNDS,
      deadLetter: 'job-dead-letter',
    });
  },
);

test('job-dead-letter has the same bounds and no dead-letter queue, so a dead job of it ends failed and the chain stops', () => {
  const settings = queueSettings({ name: 'job-dead-letter', policy: 'standard' });
  expect(settings).toEqual({ policy: 'standard', ...EXPECTED_BOUNDS });
  expect(settings).not.toHaveProperty('deadLetter');
});

test('the queues are created dead-letter queue first, then the others in the order of the definitions, each once', () => {
  expect(DEFINITIONS_IN_CREATION_ORDER.map(({ name }) => name)).toEqual([
    'job-dead-letter',
    ...QUEUES.filter((name) => name !== 'job-dead-letter'),
  ]);
  expect(DEFINITIONS_IN_CREATION_ORDER).toHaveLength(QUEUE_DEFINITIONS.length);
});
