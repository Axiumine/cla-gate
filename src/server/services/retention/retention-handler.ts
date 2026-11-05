// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { JobHandler } from '../job-registry.ts';
import { type RetentionDeps, runRetentionSweep } from './retention-sweep.ts';

// The consumer of the `retention-sweep` job (E22-S04). The queue and the daily schedule are E07's (`QUEUES`,
// `adapters/jobs/retention-schedule.ts`): the handler is what they run.

/**
 * `retention-sweep`: the job carries no data. The sweep runs with the signal of the job, so a shutdown stops it between two
 * batches, and logs the two counts (numbers only, never a row). The outcome says whether anything was deleted. An error is not
 * caught: the job fails, the queue retries it within its bounded `retryLimit` and, when the retries are spent, dead-letters
 * it (E07-S05); every retry finds the batches that committed already gone.
 */
export function retentionSweepHandler(deps: RetentionDeps): JobHandler<'retention-sweep'> {
  return async (_job, { signal, logger }) => {
    const counts = await runRetentionSweep(deps, { dryRun: false, signal });
    logger.info(counts, 'retention.swept');
    return { outcome: counts.webhook_deliveries + counts.sessions === 0 ? 'nothing_due' : 'swept' };
  };
}
