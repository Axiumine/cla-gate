// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { QUEUE_DEFINITIONS, type QueueName, type QueuePolicy } from './queues.ts';

// The policy of a queue (E07-S02) cannot be changed once the queue exists, so the migrate step and the start-up check
// compare what the database has with {@link QUEUE_DEFINITIONS} and refuse a difference.

/** A queue as pg-boss reports it: the policy is missing when pg-boss gives none, which is `standard`. */
export interface ExistingQueue {
  readonly name: string;
  readonly policy?: string;
}

/** A queue that exists with another policy than {@link QUEUE_DEFINITIONS} gives it. */
export interface PolicyMismatch {
  readonly queue: QueueName;
  readonly found: string;
  readonly expected: QueuePolicy;
}

/**
 * Thrown by the migrate step and at start-up (E07-S02) for queues whose policy is not the one of {@link QUEUE_DEFINITIONS}.
 * pg-boss cannot change the policy of a queue that exists, and the serialisation of a pull request's evaluations depends
 * on it, so a queue created by an older build is refused instead of used. Carries queue names and policy names only.
 */
export class QueuePolicyError extends Error {
  override readonly name = 'QueuePolicyError';
  readonly mismatches: readonly PolicyMismatch[];

  constructor(mismatches: readonly PolicyMismatch[]) {
    const list = mismatches.map(({ queue, found, expected }) => `${queue} is ${found}, not ${expected}`).join('; ');
    super(
      `Job queues have the wrong policy: ${list}. pg-boss cannot change a queue's policy: stop the workers, delete the queue (its jobs go with it) and run yarn db:migrate`,
    );
    this.mismatches = mismatches;
  }
}

/** The queues among `existing` whose policy is not the one of {@link QUEUE_DEFINITIONS}, in the order of the list. */
export function policyMismatches(existing: readonly ExistingQueue[]): PolicyMismatch[] {
  const mismatches: PolicyMismatch[] = [];
  for (const { name, policy: expected } of QUEUE_DEFINITIONS) {
    const row = existing.find((candidate) => candidate.name === name);
    const found = row?.policy ?? 'standard';
    if (row !== undefined && found !== expected) {
      mismatches.push({ queue: name, found, expected });
    }
  }
  return mismatches;
}
