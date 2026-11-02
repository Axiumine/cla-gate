// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { JobEnqueuer } from './ports/jobs.ts';

/** There is no queue behind the server yet: a job cannot be sent, so nothing that needs one may be acknowledged. */
class JobQueueNotWiredError extends Error {
  override readonly name = 'JobQueueNotWiredError';

  constructor() {
    super('No job queue is wired: the job was not sent');
  }
}

/**
 * The enqueuer of a server that was built without a queue (E06-S06). It sends nothing and fails every send, so a
 * delivery that would start a job is rolled back and answered `503` instead of being acknowledged with its job lost,
 * and GitHub's delivery log shows the failure until the queue exists (E07-S01 wires the real one in its place).
 */
export const notWiredEnqueuer: JobEnqueuer = {
  enqueue: () => Promise.reject(new JobQueueNotWiredError()),
};
