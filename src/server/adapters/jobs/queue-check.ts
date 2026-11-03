// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Boss } from './boss.ts';
import { type ExistingQueue, policyMismatches, QueuePolicyError } from './queue-policy.ts';
import { QUEUES, type QueueName } from './queues.ts';

/** Thrown at start-up when the database lacks queues of {@link QUEUES}: the migrate step has not run, or ran with an older build. Carries queue names only. */
export class MissingQueuesError extends Error {
  override readonly name = 'MissingQueuesError';
  readonly queues: readonly QueueName[];

  constructor(queues: readonly QueueName[]) {
    super(`Job queues are missing: ${queues.join(', ')}`);
    this.queues = queues;
  }
}

function missingAmong(existing: readonly ExistingQueue[]): QueueName[] {
  const found = new Set(existing.map((queue) => queue.name));
  return QUEUES.filter((name) => !found.has(name));
}

/** The queues of {@link QUEUES} that do not exist in the database, in the order of the constant. */
export async function missingQueues(boss: Boss): Promise<QueueName[]> {
  return missingAmong(await boss.getQueues([...QUEUES]));
}

/**
 * The start-up check: every queue of {@link QUEUES} exists and has its policy.
 * @throws MissingQueuesError naming the queues the database lacks; QueuePolicyError for queues of the wrong policy.
 */
export async function assertQueues(boss: Boss): Promise<void> {
  const existing = await boss.getQueues([...QUEUES]);
  const missing = missingAmong(existing);
  if (missing.length > 0) {
    throw new MissingQueuesError(missing);
  }
  const mismatches = policyMismatches(existing);
  if (mismatches.length > 0) {
    throw new QueuePolicyError(mismatches);
  }
}
