// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../../adapters/db/schema.ts';
import { SWEEP_INSTALLATION_WINDOW_SECONDS } from '../../domain/sweep.ts';
import { listServedInstallationIds } from '../installation-queries.ts';
import type { ReconcileOutcome } from '../installation-reconcile.ts';
import type { JobOutcome } from '../job-registry.ts';
import type { SweepContext } from './sweep-ports.ts';

// The `sweep` job (E07-S08): the scheduler starts it every `SWEEP_INTERVAL_MINUTES`. It brings the stored installations in
// line with what GitHub lists (E05-S08), then starts one `sweep-installation` job per installation the instance serves,
// so that each installation is swept on its own: its rate limit, its failure and its size are its own.

/** What the `sweep` job needs from outside its queue. */
export interface SweepDeps {
  readonly db: Kysely<Database>;
  /** Syncs every installation GitHub lists and every stored one it did not (E05-S08), with its requests bound to `signal`. */
  readonly reconcileInstallations: (signal: AbortSignal) => Promise<ReconcileOutcome>;
}

/**
 * Reconciles the installations and sends a `sweep-installation` job for each one that is admitted, not suspended and not
 * deleted, in one transaction. Each send has a dedupe key per installation, so a sweep that is retried, or two that
 * overlap, start one job per installation in the window.
 * @throws what GitHub (the list of installations), the database or the queue throws: the job fails and the queue retries
 * it. The sync of one installation that fails is not one of them: it is logged by the reconciliation and left to the next run.
 */
export async function sweep(deps: SweepDeps, context: SweepContext): Promise<JobOutcome> {
  const reconciled = await deps.reconcileInstallations(context.signal);
  const installations = await listServedInstallationIds(deps.db);
  let dropped = 0;
  await deps.db.transaction().execute(async (tx) => {
    for (const githubInstallationId of installations) {
      const outcome = await context.enqueuer.enqueue(
        tx,
        { type: 'sweep-installation', githubInstallationId },
        {
          idempotencyKey: `sweep:${context.jobId}:${String(githubInstallationId)}`,
          dedupeKey: `sweep-installation:${String(githubInstallationId)}`,
          dedupeWindowSeconds: SWEEP_INSTALLATION_WINDOW_SECONDS,
        },
      );
      dropped += outcome === 'deduplicated' ? 1 : 0;
    }
  });
  context.logger.info(
    { installations: installations.length, deduplicated: dropped, ...reconciled },
    'sweep.fanned_out',
  );
  return { outcome: 'fanned_out' };
}
