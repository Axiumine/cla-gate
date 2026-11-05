// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { policyMismatches, QueuePolicyError } from './queue-policy.ts';
import { QUEUE_DEFINITIONS } from './queues.ts';

// Comparing the policy a queue has with the one the definitions give it (E07-S02).

const EXISTING = QUEUE_DEFINITIONS.map(({ name, policy }) => ({ name, policy }));

test('queues with the policy of the table have no mismatch', () => {
  expect(policyMismatches(EXISTING)).toEqual([]);
});

test('a queue of the wrong policy is a mismatch that says what it is and what it should be, in the order of the constant', () => {
  const existing = EXISTING.map((queue) =>
    queue.name === 'evaluate-pr' || queue.name === 'sweep' ? { ...queue, policy: 'short' } : queue,
  );
  expect(policyMismatches(existing)).toEqual([
    { queue: 'evaluate-pr', found: 'short', expected: 'singleton' },
    { queue: 'sweep', found: 'short', expected: 'exclusive' },
  ]);
});

test('a queue that pg-boss reports with no policy is a standard one: that is a mismatch for the queues that are not standard (E07-S09 adds two singleton ones, E22-S04 an exclusive one)', () => {
  const existing = EXISTING.map(({ name }) => ({ name }));
  expect(policyMismatches(existing)).toEqual([
    { queue: 'evaluate-pr', found: 'standard', expected: 'singleton' },
    { queue: 'sweep', found: 'standard', expected: 'exclusive' },
    { queue: 'finalise-repository', found: 'standard', expected: 'singleton' },
    { queue: 'finalise-check', found: 'standard', expected: 'singleton' },
    { queue: 'retention-sweep', found: 'standard', expected: 'exclusive' },
  ]);
});

test('a sweep queue an earlier build created as a standard one is refused (E07-S08): at most one sweep job can exist only on an exclusive queue', () => {
  const existing = EXISTING.map((queue) => (queue.name === 'sweep' ? { ...queue, policy: 'standard' } : queue));
  expect(policyMismatches(existing)).toEqual([{ queue: 'sweep', found: 'standard', expected: 'exclusive' }]);
});

test('a queue that is absent or not ours is no mismatch: that is the business of the missing check', () => {
  expect(policyMismatches([{ name: 'not-ours', policy: 'exclusive' }])).toEqual([]);
});

test('the policy error names queues and policies and the way out, and nothing else', () => {
  const error = new QueuePolicyError([
    { queue: 'evaluate-pr', found: 'standard', expected: 'singleton' },
    { queue: 'sweep', found: 'short', expected: 'standard' },
  ]);
  expect(error.message).toBe(
    "Job queues have the wrong policy: evaluate-pr is standard, not singleton; sweep is short, not standard. pg-boss cannot change a queue's policy: stop the workers, delete the queue (its jobs go with it) and run yarn db:migrate",
  );
  expect(error.name).toBe('QueuePolicyError');
  expect(error).toBeInstanceOf(Error);
});
