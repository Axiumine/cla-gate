// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import {
  ALLOWLIST_ENTRY_PATH,
  allowlistPageSchema,
  INSTALLATION_ALLOWLIST_PATH,
  REPOSITORY_ALLOWLIST_PATH,
  repositoryAllowlistPageSchema,
} from '../../../../shared/allowlist.ts';
import type { PersonName } from '../../db/tenant-fixture/test-support.ts';
import { allowlistWorld } from '../allowlist-entry-fixture/test-support.ts';
import { type DocumentWorld, parsed } from '../document-fixture/test-support.ts';

// The helpers of the tests of the lists and of the removal of allowlist entries (E14-S07), on the world of the add (E14-S06): two
// tenants, five people, the real app on PGlite, a fake queue and a fake GitHub. Tenant 1 has the plain repository `org-1/repo` (off) and
// `org-1/scoped` (on, with a document of its own); each tenant has two entries the world seeds: one that covers the installation
// (GitHub id `n * 100`, `entryId` of the tenant) and one of the plain repository (`n * 100 + 1`).

export { allowlistWorld };

/** The path of the entries of the installation `installationId`, with the query string `query` (with its `?`, or none). */
const installationEntriesUrl = (installationId: number | string, query = ''): string =>
  INSTALLATION_ALLOWLIST_PATH.replace(':installationId', String(installationId)) + query;

/** The path of the entries of the repository `repositoryId`, with the query string `query`. */
const repositoryEntriesUrl = (repositoryId: number | string, query = ''): string =>
  REPOSITORY_ALLOWLIST_PATH.replace(':repositoryId', String(repositoryId)) + query;

/** The path of one entry (`entryId` as the text of the path, so a test can name one that is not a number). */
const entryUrl = (installationId: number | string, entryId: number | string): string =>
  ALLOWLIST_ENTRY_PATH.replace(':installationId', String(installationId)).replace(':entryId', String(entryId));

/** Lists the entries of the installation `installationId` as `who`. */
export function listInstallationAs(
  world: DocumentWorld,
  who: PersonName | null,
  installationId: number | string,
  query = '',
) {
  return world.ask(who, { method: 'GET', url: installationEntriesUrl(installationId, query) });
}

/** Lists the entries of the repository `repositoryId` as `who`. */
export function listRepositoryAs(
  world: DocumentWorld,
  who: PersonName | null,
  repositoryId: number | string,
  query = '',
) {
  return world.ask(who, { method: 'GET', url: repositoryEntriesUrl(repositoryId, query) });
}

/** Removes the entry `entryId` of the installation `installationId` as `who`. */
export function removeEntryAs(
  world: DocumentWorld,
  who: PersonName | null,
  installationId: number | string,
  entryId: number | string,
) {
  return world.ask(who, { method: 'DELETE', url: entryUrl(installationId, entryId) });
}

/** The page of a `200` of the list of an installation, read with the shared schema. */
export const installationPageOf = (response: { json: () => unknown }) => parsed(response, allowlistPageSchema);

/** The page of a `200` of the list of a repository, read with the shared schema. */
export const repositoryPageOf = (response: { json: () => unknown }) => parsed(response, repositoryAllowlistPageSchema);

/** An entry to store, directly in the table: the world's own routes make the entries a test is about only when it is about the add. */
export interface EntryToStore {
  readonly installationId: number;
  /** `repositories.id`, or null for an entry that covers the installation. */
  readonly repositoryId: number | null;
  readonly kind: 'user' | 'bot' | 'org_members';
  readonly githubId: number;
  readonly loginSnapshot: string | null;
  /** `users.id` of who made it. */
  readonly createdBy: number;
}

/** Stores the entries in the order given and returns their ids in that order. */
export async function storeEntries(world: DocumentWorld, entries: readonly EntryToStore[]): Promise<number[]> {
  const ids: number[] = [];
  for (const entry of entries) {
    const row = await world.db
      .insertInto('allowlist_entries')
      .values({
        installation_id: entry.installationId,
        repository_id: entry.repositoryId,
        kind: entry.kind,
        github_id: entry.githubId,
        login_snapshot: entry.loginSnapshot,
        created_by: entry.createdBy,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    ids.push(row.id);
  }
  return ids;
}

/** The `allowlist_entry.deleted` audit rows, oldest first. */
export function deletedAuditRows(world: DocumentWorld) {
  return world.db
    .selectFrom('audit_log')
    .selectAll()
    .where('action', '=', 'allowlist_entry.deleted')
    .orderBy('id')
    .execute();
}

/** The ids of the entries the table holds for the installation `installationId`, ascending. */
export async function entryIdsOf(world: DocumentWorld, installationId: number): Promise<number[]> {
  const rows = await world.db
    .selectFrom('allowlist_entries')
    .select('id')
    .where('installation_id', '=', installationId)
    .orderBy('id')
    .execute();
  return rows.map((row) => row.id);
}

/** The id of the entry of the tenant `installationId` with this GitHub id (the world seeds `n * 100` and `n * 100 + 1`). */
export async function entryIdOfAccount(
  world: DocumentWorld,
  installationId: number,
  githubId: number,
): Promise<number> {
  const row = await world.db
    .selectFrom('allowlist_entries')
    .select('id')
    .where('installation_id', '=', installationId)
    .where('github_id', '=', githubId)
    .executeTakeFirstOrThrow();
  return row.id;
}
