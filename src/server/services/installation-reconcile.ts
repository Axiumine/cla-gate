// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Logger } from 'pino';
import type { GithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import { listLiveInstallationIds } from './installation-queries.ts';
import type { SyncOutcome } from './installation-sync-model.ts';
import type { GitHubClient } from './ports/github.ts';

// The reconciliation of E05-S08: the installations GitHub lists and the ones stored are compared and each is synced.

/** What one reconciliation did. */
export interface ReconcileOutcome {
  /** Installations whose sync finished, whether or not it wrote anything. */
  readonly synced: number;
  /** Installations whose sync threw; each is logged as `installation.sync_failed` and left for the next run. */
  readonly failed: number;
}

export interface ReconcileOptions {
  readonly db: Kysely<Database>;
  readonly github: GitHubClient;
  readonly logger: Logger;
  readonly sync: (githubInstallationId: GithubId) => Promise<SyncOutcome>;
}

/**
 * Syncs, one after the other, every installation GitHub lists and then every stored, non-deleted installation it did not
 * list (the sync confirms those with `getInstallation` and marks them deleted on a 404). The list of GitHub installations
 * is the whole list or an error, never a truncated one, so a missing installation really is missing.
 */
export async function reconcileInstallations(options: ReconcileOptions): Promise<ReconcileOutcome> {
  const { db, github, logger, sync } = options;
  const listed = (await github.listInstallations()).map((installation) => installation.id);
  const listedIds = new Set(listed);
  const unlisted = (await listLiveInstallationIds(db)).filter((githubId) => !listedIds.has(githubId));
  let synced = 0;
  let failed = 0;
  for (const githubInstallationId of new Set([...listed, ...unlisted])) {
    try {
      await sync(githubInstallationId);
      synced += 1;
    } catch (error) {
      failed += 1;
      logger.warn({ err: error, githubInstallationId }, 'installation.sync_failed');
    }
  }
  logger.info({ listed: listed.length, unlisted: unlisted.length, synced, failed }, 'installation.reconciled');
  return { synced, failed };
}
