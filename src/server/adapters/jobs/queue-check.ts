// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Boss } from './boss.ts';
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

/** The queues of {@link QUEUES} that do not exist in the database, in the order of the constant. */
export async function missingQueues(boss: Boss): Promise<QueueName[]> {
  const found = new Set((await boss.getQueues([...QUEUES])).map((queue) => queue.name));
  return QUEUES.filter((name) => !found.has(name));
}
