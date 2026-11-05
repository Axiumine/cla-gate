// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../../adapters/db/schema.ts';
import { deliveryCutoff, sessionCutoff } from '../../domain/retention.ts';
import { appendAudit } from '../audit.ts';
import type { Clock } from '../ports/clock.ts';
import { drain } from './retention-drain.ts';
import { countDue, SESSIONS, WEBHOOK_DELIVERIES } from './retention-queries.ts';

// The retention sweep (E22-S04): operational rows that have no evidentiary value are purged, evidence is never touched. It
// deletes the webhook deliveries that were processed more than `RETENTION_WEBHOOK_DELIVERIES_DAYS` ago and the sessions that
// died more than a day ago, in batches of `RETENTION_BATCH_SIZE`, each batch in its own transaction, so a long backlog never
// holds a long lock. The scheduled job and `node src/server/retention.ts` run this one function; a dry run counts what a run
// would delete and deletes nothing. The two tables are the only ones named in `retention-queries.ts`, which is where the sweep
// reads and writes; the one other table it writes is `audit_log`, through the audit writer, to record what it deleted.

/**
 * The two settings of the sweep, from the configuration.
 *
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export interface RetentionSettings {
  /** `RETENTION_WEBHOOK_DELIVERIES_DAYS`: the whole days a processed delivery is kept, 7 to 3650. */
  readonly webhookDeliveriesDays: number;
  /** `RETENTION_BATCH_SIZE`: the rows one batch deletes. */
  readonly batchSize: number;
}

export interface RetentionDeps {
  readonly db: Kysely<Database>;
  /** Where "now" comes from, so that a test moves time by hand. */
  readonly clock: Clock;
  readonly settings: RetentionSettings;
}

/** How many rows of each table a run deleted (or, for a dry run, would delete). Numbers only: they are also the metadata of the audit row. */
export interface RetentionCounts {
  readonly webhook_deliveries: number;
  readonly sessions: number;
}

export interface RetentionRun {
  /** Count what would be deleted and delete nothing. */
  readonly dryRun: boolean;
  /** Aborts when the job must stop: the sweep stops between two batches, and what it deleted stays deleted. */
  readonly signal?: AbortSignal | undefined;
}

/**
 * Appends the one audit row of a run, `retention.swept`: no actor and no installation (the sweep is a schedule and reaches the
 * whole instance), and the two counts as the only metadata. A run that deleted nothing writes none.
 */
async function recordSwept(db: Kysely<Database>, counts: RetentionCounts): Promise<void> {
  if (counts.webhook_deliveries + counts.sessions === 0) {
    return;
  }
  await db.transaction().execute((trx) =>
    appendAudit(trx, {
      action: 'retention.swept',
      installationId: null,
      actorGithubId: null,
      metadata: { webhook_deliveries: counts.webhook_deliveries, sessions: counts.sessions },
    }),
  );
}

/** What a run would delete: the same conditions as the batches, counted. */
async function countAll(deps: RetentionDeps, cutoffs: { deliveries: Date; sessions: Date }): Promise<RetentionCounts> {
  return {
    webhook_deliveries: await countDue(deps.db, WEBHOOK_DELIVERIES, cutoffs.deliveries),
    sessions: await countDue(deps.db, SESSIONS, cutoffs.sessions),
  };
}

/**
 * Runs the sweep once and resolves to the counts. The cutoffs are computed once from the clock, so one run judges every row
 * against one instant. A real run that deleted something appends the audit row `retention.swept` (a dry run and an empty run
 * write none). An error from the database is not caught: the batches that committed stay committed, the audit row records
 * what they deleted (when that can still be written), and the error is thrown for the queue to retry, so the next run
 * continues with what is left.
 * @throws whatever a statement throws, or the reason of `run.signal` when it aborted between two batches.
 */
export async function runRetentionSweep(deps: RetentionDeps, run: RetentionRun): Promise<RetentionCounts> {
  const { db, settings } = deps;
  const now = deps.clock.now().getTime();
  const cutoffs = {
    deliveries: new Date(deliveryCutoff(now, settings.webhookDeliveriesDays)),
    sessions: new Date(sessionCutoff(now)),
  };
  if (run.dryRun) {
    return countAll(deps, cutoffs);
  }
  const done = { webhook_deliveries: 0, sessions: 0 };
  const common = { batchSize: settings.batchSize, signal: run.signal };
  try {
    await drain(db, WEBHOOK_DELIVERIES, { ...common, cutoff: cutoffs.deliveries }, (deleted) => {
      done.webhook_deliveries += deleted;
    });
    await drain(db, SESSIONS, { ...common, cutoff: cutoffs.sessions }, (deleted) => {
      done.sessions += deleted;
    });
  } catch (error) {
    // The audit row is a record of what was deleted; if it cannot be written either (the database is the problem), the original error is the one to report.
    await recordSwept(db, done).catch(() => undefined);
    throw error;
  }
  await recordSwept(db, done);
  return done;
}
