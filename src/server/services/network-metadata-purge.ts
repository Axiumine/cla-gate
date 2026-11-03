// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import { retentionCutoff } from '../domain/network-retention.ts';
import type { Clock } from './ports/clock.ts';

// The consumer of the `purge-network-metadata` job (E16-S05). The IP address and the user agent that a signing may store
// (E13-S05) are kept for a short, enforced period; every day this handler removes the ones older than that, through the
// SQL function `purge_signer_network_metadata` (the only code that may change those columns, and the only writer of the
// audit row `network_metadata.purged`). The queue and the scheduler are E07: the handler is what they run.

/** The queue of the job and the `type` of its envelope. */
export const PURGE_NETWORK_METADATA_JOB = 'purge-network-metadata';

/**
 * When the job runs: every day at 03:17 UTC, a minute that no other schedule uses, in the UTC time zone (a cron
 * expression without a zone is read in the zone of the scheduler's host).
 */
export const PURGE_NETWORK_METADATA_SCHEDULE = { cron: '17 3 * * *', timezone: 'UTC' } as const;

/** The part of a logger the handler uses: an info line with plain fields. */
interface HandlerLog {
  info(fields: object, message: string): void;
}

export interface PurgeNetworkMetadataDeps {
  readonly db: Kysely<Database>;
  /** Where "now" comes from, so that a test moves time by hand. */
  readonly clock: Clock;
  /** `NETWORK_METADATA_RETENTION_DAYS`: the whole days a value is kept. */
  readonly retentionDays: number;
  readonly log: HandlerLog;
}

/**
 * The handler of `purge-network-metadata`. It computes the cutoff (the injected clock's now minus the retention),
 * calls the function and logs the number of rows and the cutoff, nothing else. It does not look at whether recording is
 * switched on: switching it off must never strand the values stored while it was on. The purge is instance-wide on
 * purpose, because retention is a setting of the instance and not of a tenant. The job is idempotent: a second run on
 * the same data changes nothing and succeeds with 0. An error from the database is not caught: the function is one call
 * that undoes itself, so the job fails with nothing half done, the queue retries it and, after the limit, dead-letters it
 * (E07-S05). Resolves to the number of rows whose values were removed.
 */
export function createPurgeNetworkMetadataHandler(deps: PurgeNetworkMetadataDeps): () => Promise<number> {
  return async () => {
    const cutoff = new Date(retentionCutoff(deps.clock.now().getTime(), deps.retentionDays)).toISOString();
    const { purged } = await deps.db
      .selectNoFrom(sql<number>`purge_signer_network_metadata(${cutoff}::timestamptz)`.as('purged'))
      .executeTakeFirstOrThrow();
    deps.log.info({ rows: purged, cutoff }, 'network_metadata_purge_done');
    return purged;
  };
}
