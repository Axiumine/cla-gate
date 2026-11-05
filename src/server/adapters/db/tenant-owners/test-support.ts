// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { TenantRows } from '../../../services/tenant-queries.ts';
import type { Database } from '../schema.ts';

// The reads that tell the registry of the tenant data access (tenant-registry/test-support.ts) who owns the rows a query
// touched (E11-S06): each one reads the table again, by id, and answers the installations found, so a query is judged by the
// database and not by its own answer. Moved out of the registry when E16-S04 added its entries and the file reached the cap.

/** The installation that owns each repository stored under these GitHub ids, in any state. */
export async function ownersOfGithubIds(db: Kysely<Database>, githubRepoIds: readonly number[]): Promise<number[]> {
  if (githubRepoIds.length === 0) {
    return [];
  }
  const rows = await db
    .selectFrom('repositories')
    .select('installation_id')
    .where('github_repo_id', 'in', githubRepoIds)
    .execute();
  return rows.map((row) => row.installation_id);
}

/** The installation that owns each repository with these row ids. */
export async function ownersOfRepositories(db: Kysely<Database>, repositoryIds: readonly number[]): Promise<number[]> {
  const rows = await db.selectFrom('repositories').select('installation_id').where('id', 'in', repositoryIds).execute();
  return rows.map((row) => row.installation_id);
}

/** The installation that owns each document with these row ids. */
export async function ownersOfDocuments(db: Kysely<Database>, documentIds: readonly number[]): Promise<number[]> {
  const rows = await db.selectFrom('cla_documents').select('installation_id').where('id', 'in', documentIds).execute();
  return rows.map((row) => row.installation_id);
}

/** The installation that owns each audit row with these row ids (an instance-level row has none and is left out). */
export async function ownersOfAuditRows(db: Kysely<Database>, auditIds: readonly number[]): Promise<number[]> {
  if (auditIds.length === 0) {
    return [];
  }
  const rows = await db
    .selectFrom('audit_log')
    .select('installation_id')
    .where('id', 'in', auditIds)
    .where('installation_id', 'is not', null)
    .$narrowType<{ installation_id: number }>()
    .execute();
  return rows.map((row) => row.installation_id);
}

/** The installation that owns each signature with these row ids. */
export async function ownersOfSignatures(db: Kysely<Database>, signatureIds: readonly number[]): Promise<number[]> {
  const rows = await db.selectFrom('signatures').select('installation_id').where('id', 'in', signatureIds).execute();
  return rows.map((row) => row.installation_id);
}

/** The GitHub ids of the repositories that are removed, in any tenant. */
export async function removedRepositories(db: Kysely<Database>): Promise<number[]> {
  const rows = await db
    .selectFrom('repositories')
    .select('github_repo_id')
    .where('removed_at', 'is not', null)
    .execute();
  return rows.map((row) => row.github_repo_id);
}

/** The installations that hold an entry of the ledger of org admins for this person, found by reading the table. */
export async function ledgerOwnersOf(db: Kysely<Database>, person: number): Promise<number[]> {
  const rows = await db
    .selectFrom('installation_admin_seen')
    .select('installation_id')
    .where('user_github_id', '=', person)
    .execute();
  return rows.map((row) => row.installation_id);
}

/**
 * The installations that own the rows the guard's read returned: the installation and its repository, which the
 * registry always asks for.
 * @throws Error when the read answers an installation with no repository: the entry asked for one.
 */
export function ownersOfTenantRows(rows: TenantRows | null): number[] {
  if (rows === null) {
    return [];
  }
  if (rows.repository === null) {
    throw new Error('the registry asks for a repository and the read answered none');
  }
  return [rows.installation.id, rows.repository.installation_id];
}
