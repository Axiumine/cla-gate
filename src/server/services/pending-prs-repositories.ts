// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import type { LookupRepository } from './administered-repositories.ts';
import { SERVED } from './pending-prs-served.ts';

// The repositories the pending pull requests may come from (E15-S07). Every statement names the installation, so a repository of another
// tenant is never read. Nothing here writes.

/**
 * The repositories of the tenant that are served (see above), in the order of their id, with the ids a role lookup needs. `repositoryId`
 * narrows the answer to that one, `ownDocumentOnly` to the ones whose enforced CLA document is scoped to the repository itself: the
 * only ones a repository admin is found through (E11-S03, and the repository-action rule of E14-S01).
 */
export function servedRepositories(
  db: Kysely<Database>,
  scope: TenantScope,
  narrow: { readonly repositoryId: number | null; readonly ownDocumentOnly: boolean },
): Promise<LookupRepository[]> {
  const served = db
    .selectFrom('repositories as r')
    .innerJoin('installations as i', 'i.id', 'r.installation_id')
    .select([
      'r.id',
      'r.github_repo_id as githubRepoId',
      'r.full_name as fullName',
      'i.github_installation_id as githubInstallationId',
    ])
    .where('r.installation_id', '=', scope.installationId)
    .where(SERVED)
    .orderBy('r.id');
  const named = narrow.repositoryId === null ? served : served.where('r.id', '=', narrow.repositoryId);
  const narrowed = narrow.ownDocumentOnly
    ? named.where((eb) =>
        eb.exists(
          eb
            .selectFrom('cla_documents as d')
            .select('d.id')
            .whereRef('d.id', '=', 'r.cla_document_id')
            .whereRef('d.installation_id', '=', 'r.installation_id')
            .whereRef('d.repository_id', '=', 'r.id'),
        ),
      )
    : named;
  return narrowed.execute();
}

/** Whether the repository `repositoryId` is a row of the tenant, enabled or not, removed or not: the only thing that tells it from an id of another tenant. */
export async function isRepositoryOfTenant(
  db: Kysely<Database>,
  scope: TenantScope,
  repositoryId: number,
): Promise<boolean> {
  const row = await db
    .selectFrom('repositories')
    .select('id')
    .where('installation_id', '=', scope.installationId)
    .where('id', '=', repositoryId)
    .executeTakeFirst();
  return row !== undefined;
}
