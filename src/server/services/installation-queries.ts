// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { GithubId } from '../../shared/github-id.ts';
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
