// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Logger } from 'pino';
import type { Database } from '../adapters/db/schema.ts';
import type { InstallationAdmission } from './installation-admission.ts';
import type { Clock } from './ports/clock.ts';

// The shapes the installation sync (E05-S08) passes between its steps: what a run found and did, and what its steps use.

/**
 * Where a sync run ended.
 * - `unknown`: GitHub does not have the installation and nothing is stored for it, so there was nothing to do.
 * - `deleted`: the installation is uninstalled (marked now, or already marked before).
 * - `rejected`: the admission policy does not serve the account; nothing but the decision was written.
 * - `suspended`: GitHub suspended the installation; the repositories were not listed.
 * - `synced`: admitted and active, and its repositories were reconciled.
 */
export type SyncStatus = 'unknown' | 'deleted' | 'rejected' | 'suspended' | 'synced';

/** How many repositories a run brought in line with GitHub. */
interface RepositoryTally {
  /** Inserted, or listed again after having been removed. */
  readonly added: number;
  /** Active before and after, with a new `full_name`. */
  readonly renamed: number;
  /** Stored as active and no longer listed. */
  readonly removed: number;
}

export interface SyncOutcome {
  readonly status: SyncStatus;
  /**
   * A row was written: the installation, a repository or an audit entry. False on a second run over unchanged state,
   * which writes nothing at all (not even `last_synced_at`).
   */
  readonly changed: boolean;
  readonly repositories: RepositoryTally;
}

const NO_REPOSITORIES: RepositoryTally = { added: 0, renamed: 0, removed: 0 };

/** A run that ended at `status` and wrote nothing. */
export const untouched = (status: SyncStatus): SyncOutcome => ({
  status,
  changed: false,
  repositories: NO_REPOSITORIES,
});

/** What the steps of one sync share. */
export interface SyncContext {
  readonly db: Kysely<Database>;
  readonly admission: InstallationAdmission;
  readonly clock: Clock;
  readonly logger: Logger;
}

/** The account type as the audit metadata spells it: a code, so lower case. */
export const accountTypeCode = (type: 'Organization' | 'User'): 'organization' | 'user' =>
  type === 'User' ? 'user' : 'organization';
