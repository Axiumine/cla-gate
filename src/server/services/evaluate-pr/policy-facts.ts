// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { InstallationRowId } from '../../adapters/db/installation-row-id.ts';
import type { Database } from '../../adapters/db/schema.ts';
import type { AllowlistEntry, Policy } from '../../domain/evaluation/index.ts';
import { batches } from '../repository-rows.ts';

// What the stored policy says about a repository (E07-S04): the CLA in force, the allowlist and the per-commit overrides. The
// evaluation reads them as plain facts and the engine decides. Every statement filters by the installation
// (`installations.id`), so a fact of another tenant can never reach the engine. The signatures are in signature-facts.ts.

/** The tenant a read is made for: the database, the installation and the repository, as the ids of the tables. */
export interface PolicyScope {
  readonly db: Kysely<Database>;
  readonly installationId: InstallationRowId;
  readonly repositoryId: number;
}

/**
 * The CLA the repository enforces: its document and the major version of the active version, or `null` when it has no
 * document or the document has no active version (the engine then fails the pull request with `no_active_cla`).
 */
export async function readPolicy(scope: PolicyScope, claDocumentId: number | null): Promise<Policy | null> {
  if (claDocumentId === null) {
    return null;
  }
  const row = await scope.db
    .selectFrom('cla_documents as document')
    .innerJoin('cla_versions as version', 'version.id', 'document.active_version_id')
    .select(['document.id as documentId', 'version.major as activeMajor'])
    .where('document.id', '=', claDocumentId)
    .where('document.installation_id', '=', scope.installationId)
    .executeTakeFirst();
  return row ?? null;
}

/** The allowlist of the repository: its own entries and the installation-wide ones, with the scope each has. */
export async function readAllowlist(scope: PolicyScope): Promise<AllowlistEntry[]> {
  const rows = await scope.db
    .selectFrom('allowlist_entries')
    .select(['id', 'kind', 'github_id', 'repository_id'])
    .where('installation_id', '=', scope.installationId)
    .where((condition) =>
      condition.or([condition('repository_id', 'is', null), condition('repository_id', '=', scope.repositoryId)]),
    )
    .orderBy('id')
    .execute();
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    githubId: row.github_id,
    scope: row.repository_id === null ? 'installation' : 'repository',
  }));
}

/** The overrides of the repository for `shas`, as the engine takes them: the commit SHA to the id of its override. */
export async function readOverrides(scope: PolicyScope, shas: readonly string[]): Promise<Map<string, number>> {
  const overrides = new Map<string, number>();
  for (const batch of batches(shas)) {
    const rows = await scope.db
      .selectFrom('commit_overrides')
      .select(['id', 'commit_sha'])
      .where('installation_id', '=', scope.installationId)
      .where('repository_id', '=', scope.repositoryId)
      .where('commit_sha', 'in', batch)
      .execute();
    for (const row of rows) {
      overrides.set(row.commit_sha, row.id);
    }
  }
  return overrides;
}
