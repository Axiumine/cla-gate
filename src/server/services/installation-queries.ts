// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { type GithubId, parseGithubId } from '../../shared/github-id.ts';
import type { InstallationRowId } from '../adapters/db/installation-row-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import { type InstallationRow, type InstallationUpsert, stateColumns } from './installation-state.ts';

/**
 * Inserts the installation, or refreshes the snapshot of the one stored for the same `githubInstallationId`; the other
 * installations are never read or written. The account id is a part of the identity of the row: a different one for a
 * known installation is refused by the database (`restrict_violation`) and nothing changes.
 */
export async function upsertInstallation(db: Kysely<Database>, input: InstallationUpsert): Promise<InstallationRow> {
  const snapshot = {
    account_id: input.accountId,
    account_login: input.accountLogin,
    account_type: input.accountType,
    suspended_at: input.suspendedAt,
    ...stateColumns(input),
  };
  return await db
    .insertInto('installations')
    .values({ github_installation_id: input.githubInstallationId, ...snapshot })
    .onConflict((conflict) =>
      conflict.column('github_installation_id').doUpdateSet({ ...snapshot, updated_at: sql`now()` }),
    )
    .returningAll()
    .executeTakeFirstOrThrow();
}

/** The installation GitHub knows by this id, or `null`. */
export async function findInstallationByGithubId(
  db: Kysely<Database>,
  githubInstallationId: GithubId,
): Promise<InstallationRow | null> {
  const row = await db
    .selectFrom('installations')
    .selectAll()
    .where('github_installation_id', '=', githubInstallationId)
    .executeTakeFirst();
  return row ?? null;
}

/**
 * The GitHub installation ids of every installation that is not deleted, in id order: the reconciliation (E05-S08)
 * compares them with what GitHub lists. Like the operator's view this reads across tenants by design, and returns ids only.
 */
export async function listLiveInstallationIds(db: Kysely<Database>): Promise<GithubId[]> {
  const rows = await db
    .selectFrom('installations')
    .select('github_installation_id')
    .where('deleted_at', 'is', null)
    .orderBy('github_installation_id')
    .execute();
  return rows.map((row) => parseGithubId(row.github_installation_id));
}

/** Records that a sync wrote this installation's state at `at`. Touches the one row `installationId` names (`installations.id`). */
export async function markInstallationSynced(
  db: Kysely<Database>,
  installationId: InstallationRowId,
  at: Date,
): Promise<void> {
  await db
    .updateTable('installations')
    .set({ last_synced_at: at, updated_at: sql`now()` })
    .where('id', '=', installationId)
    .execute();
}

/** Marks the installation uninstalled at `at` (E05-S08); the row, its repositories and its signatures stay. */
export async function markInstallationDeleted(
  db: Kysely<Database>,
  installationId: InstallationRowId,
  at: Date,
): Promise<void> {
  await db
    .updateTable('installations')
    .set({ deleted_at: at, last_synced_at: at, updated_at: sql`now()` })
    .where('id', '=', installationId)
    .execute();
}

/**
 * The installation row `installationId` (`installations.id`) names, read again under the sync's lock.
 * @throws NoResultError when it is not there; nothing deletes an installation, so that is a broken database.
 */
export function getInstallationById(db: Kysely<Database>, installationId: InstallationRowId): Promise<InstallationRow> {
  return db.selectFrom('installations').selectAll().where('id', '=', installationId).executeTakeFirstOrThrow();
}
