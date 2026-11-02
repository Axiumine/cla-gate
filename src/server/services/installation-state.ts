// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Selectable } from 'kysely';
import type { GithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';

/** One stored installation: a tenant. `id` is the surrogate key every tenant table points at (E05-S06). */
export type InstallationRow = Selectable<Database['installations']>;

/** What GitHub says about the account an installation belongs to: a display snapshot, refreshed on every sync. */
interface InstallationSnapshot {
  readonly githubInstallationId: GithubId;
  readonly accountId: GithubId;
  readonly accountLogin: string;
  readonly accountType: 'Organization' | 'User';
  readonly suspendedAt: Date | null;
}

/** The admission policy's answer for one installation (E05-S07), with the instant it was made. */
export interface AdmissionDecision {
  readonly status: 'admitted' | 'rejected';
  readonly reason: 'account_not_allowed' | 'policy_changed' | null;
  readonly decidedAt: Date;
}

/** An installation as the sync writes it: the snapshot, and the parts of the state the caller has just decided. */
export interface InstallationUpsert extends InstallationSnapshot {
  /** Written when given. A new row without one is `rejected` (the column default), so it is never evaluated. */
  readonly admission?: AdmissionDecision;
  /** Set on an uninstall. An installation id is never reused by GitHub, so a deleted row is not revived by a sync. */
  readonly deletedAt?: Date;
  readonly lastSyncedAt?: Date;
}

/** The columns the optional parts of an upsert write; a part that is not given is not in the object. */
export interface StateColumns {
  admission_status?: AdmissionDecision['status'];
  admission_reason?: AdmissionDecision['reason'];
  admission_decided_at?: Date;
  deleted_at?: Date;
  last_synced_at?: Date;
}

export function stateColumns(input: InstallationUpsert): StateColumns {
  return {
    ...(input.admission === undefined
      ? {}
      : {
          admission_status: input.admission.status,
          admission_reason: input.admission.reason,
          admission_decided_at: input.admission.decidedAt,
        }),
    ...(input.deletedAt === undefined ? {} : { deleted_at: input.deletedAt }),
    ...(input.lastSyncedAt === undefined ? {} : { last_synced_at: input.lastSyncedAt }),
  };
}
