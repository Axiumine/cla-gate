// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { createLogger } from '../../adapters/http/logger.ts';
import { type EvaluateWorld, evaluateWorld } from '../evaluate-pr/test-support.ts';
import type { JobOutcome } from '../job-registry.ts';
import type { QueuedJob } from '../job-run.ts';
import { FakePendingJobs } from '../job-run-fixture/test-support.ts';
import { droppingEnqueuer } from '../jobs-fixture/test-support.ts';
import { deadLetterRegistry } from './dead-letter-registry.ts';
import { runDeadLetter } from './dead-letter-run.ts';

// The world of the tests of the dead-letter handlers (E07-S05): the world of the `evaluate-pr` tests (a migrated database with
// one tenant, a FakeGitHub that serves its pull request 7, a FakeReporter, a captured log) with the dead-letter table
// over the same ports, and a runner that hands a dead job to it as the queue would.

export interface DeadWorld extends EvaluateWorld {
  /** Runs one dead job with `data`: attempt 0 and a signal that has not aborted, unless `overrides` say otherwise. */
  readonly runDead: (data: unknown, overrides?: Partial<QueuedJob>) => Promise<JobOutcome>;
}

/** A world whose dead-letter handlers can reach GitHub and the reporter, or (with `evaluation: false`) cannot. */
export async function deadWorld(options: { evaluation?: boolean } = {}): Promise<DeadWorld> {
  const world = await evaluateWorld();
  const registry = deadLetterRegistry(
    {
      db: world.db,
      evaluation: options.evaluation === false ? undefined : () => ({ github: world.fake, reporter: world.reporter }),
    },
    world.ports.clock,
  );
  const logger = createLogger({ logLevel: 'info' }, world.logs.destination);
  return {
    ...world,
    runDead: (data, overrides = {}) =>
      runDeadLetter(
        { id: 'dead-1', data, retryCount: 0, signal: new AbortController().signal, ...overrides },
        { registry, logger, pending: new FakePendingJobs(), enqueuer: droppingEnqueuer },
      ),
  };
}

/** The log lines of the world that carry `msg`. */
export function logged(world: EvaluateWorld, msg: string): Record<string, unknown>[] {
  return world.logs.lines().filter((line) => line['msg'] === msg);
}
