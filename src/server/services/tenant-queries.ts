// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { InstallationRowId } from '../adapters/db/installation-row-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { InstallationRow } from './installation-state.ts';
import type { RepositoryRow } from './repository-rows.ts';

// What the tenant guard (E11-S05) reads to know what a request is about. Every read filters by the installation id; the one
// that has to find the installation of a repository from the repository alone is `installationOfRepository`, which only
// the resolver of a route keyed by the repository uses, and it answers with the id and nothing else.

/** A tenant as the guard needs it: the installation, and the repository the call is about when it names one. */
export interface TenantRows {
  readonly installation: InstallationRow;
  /** Never a removed repository. Null when the call names none. */
  readonly repository: RepositoryRow | null;
}

/**
 * The installation `installationId` (`installations.id`) names in whatever state it is, with its repository `repositoryId`
 * (`repositories.id`) when one is given. Null when the installation is not there, and when the repository is not there, is
 * removed (`removed_at` is set) or belongs to another installation: the repository is read with the installation id too.
 */
export async function findTenantRows(
  db: Kysely<Database>,
  installationId: InstallationRowId,
  repositoryId: number | null,
): Promise<TenantRows | null> {
  const installation = await db
    .selectFrom('installations')
    .selectAll()
    .where('id', '=', installationId)
    .executeTakeFirst();
  if (installation === undefined) {
    return null;
  }
  if (repositoryId === null) {
    return { installation, repository: null };
  }
  const repository = await db
    .selectFrom('repositories')
    .selectAll()
    .where('installation_id', '=', installationId)
    .where('id', '=', repositoryId)
    .where('removed_at', 'is', null)
    .executeTakeFirst();
  return repository === undefined ? null : { installation, repository };
}

/**
 * {@link findTenantRows} for a tenant the admission policy admitted: a rejected tenant is invisible, so it is null here
 * just as an unknown one is (E05-S07). What the resolvers of E11-S05 use.
 */
export async function findAdmittedTenantRows(
  db: Kysely<Database>,
  installationId: InstallationRowId,
  repositoryId: number | null,
): Promise<TenantRows | null> {
  const rows = await findTenantRows(db, installationId, repositoryId);
  return rows?.installation.admission_status === 'admitted' ? rows : null;
}

/** The installation (`installations.id`) a repository (`repositories.id`) belongs to, or null for one that is unknown or removed. */
export async function installationOfRepository(
  db: Kysely<Database>,
  repositoryId: number,
): Promise<InstallationRowId | null> {
  const row = await db
    .selectFrom('repositories')
    .select('installation_id')
    .where('id', '=', repositoryId)
    .where('removed_at', 'is', null)
    .executeTakeFirst();
  return row?.installation_id ?? null;
}
