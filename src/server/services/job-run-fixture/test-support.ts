// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { vi } from 'vitest';
import { createLogger } from '../../adapters/http/logger.ts';
import type { JobType } from '../../domain/job-envelope.ts';
import { DELIVERY_ID, IDS, JOBS } from '../../domain/test-support.ts';
import { captureLogs } from '../../test-support.ts';
import { HandlerRegistry, type JobHandler } from '../job-registry.ts';
import type { JobRunDeps, QueuedJob } from '../job-run.ts';
import type { PendingJobs, PendingWorkTarget } from '../ports/jobs.ts';
import { FakeClock } from '../test-support.ts';

// What the tests of the job wrapper and of the handlers share (E07-S03): a registry, a captured log, a clock that moves by
// hand and a delivery marker that keeps what it was asked.

export { DELIVERY_ID, IDS, JOBS };

const START = '2026-11-02T10:00:00Z';

/** The queue as a handler sees it, in memory: what it was asked to cancel, in order, and how many jobs it says it cancelled (E07-S06). */
export class FakePendingJobs implements PendingJobs {
  readonly targets: PendingWorkTarget[] = [];
  /** What `cancelForPullRequest` resolves with; a test sets it. */
  cancelled = 0;
  /** What it does when it is asked, besides noting the target: nothing, unless a test says so. */
  behaviour: ((target: PendingWorkTarget) => Promise<void>) | undefined;

  async cancelForPullRequest(target: PendingWorkTarget): Promise<number> {
    this.targets.push(target);
    await this.behaviour?.(target);
    return this.cancelled;
  }
}

export interface RunWorld {
  readonly deps: JobRunDeps;
  readonly registry: HandlerRegistry;
  readonly clock: FakeClock;
  readonly logs: ReturnType<typeof captureLogs>;
  /** The delivery ids `markDeliveryProcessed` was called with, in order. */
  readonly marked: string[];
  readonly pending: FakePendingJobs;
}

/** A wrapper world whose registry has the handlers given; `markDeliveryProcessed` records into `marked` unless replaced. */
export function runWorld(
  register: (registry: HandlerRegistry) => void,
  mark?: JobRunDeps['markDeliveryProcessed'],
): RunWorld {
  const registry = new HandlerRegistry();
  register(registry);
  const logs = captureLogs();
  const clock = new FakeClock(START);
  const marked: string[] = [];
  const pending = new FakePendingJobs();
  const deps: JobRunDeps = {
    registry,
    clock,
    pending,
    logger: createLogger({ logLevel: 'info' }, logs.destination),
    markDeliveryProcessed:
      mark ??
      ((deliveryId) => {
        marked.push(deliveryId);
        return Promise.resolve();
      }),
  };
  return { deps, registry, clock, logs, marked, pending };
}

/** A job as the queue hands it over: attempt 0 and a signal that has not aborted, unless overridden. */
export function queuedJob(data: unknown, overrides: Partial<QueuedJob> = {}): QueuedJob {
  return { id: 'job-1', data, retryCount: 0, signal: new AbortController().signal, ...overrides };
}

/** A handler of any type that completes with `outcome` and counts its calls. */
export function completing(outcome = 'done') {
  return vi.fn(() => Promise.resolve({ outcome }));
}

/** A handler of the job type `T` that completes with `outcome` and keeps the envelope and the context of its calls. */
export function recording<T extends JobType>(outcome = 'done') {
  return vi.fn<JobHandler<T>>(() => Promise.resolve({ outcome }));
}
