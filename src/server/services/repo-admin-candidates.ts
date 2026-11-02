// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { InstallationRowId } from '../adapters/db/installation-row-id.ts';
import type { Database } from '../adapters/db/schema.ts';

/** A repository the repository admin discovery may ask GitHub about: what the permission lookup needs and nothing more. */
export interface RepoAdminCandidate {
  /** The GitHub installation id the lookup's token belongs to; the tenant key of the repository is the id asked for. */
  readonly github_installation_id: number;
  /** The numeric GitHub id of the repository: what the role cache keeps the answer under (E11-S04), never the name. */
  readonly github_repo_id: number;
  readonly full_name: string;
  readonly removed_at: Date | null;
}

/**
 * The repositories of one installation that carry a repo-scoped CLA document (`cla_documents.repository_id` is set) and are
 * not removed, in repository id order, at most `limit` of them: the repositories on which a person can have a role here
 * without being an org admin (the discovery rule of E11-S03). A repository with two documents is listed once. Both the
 * repository and the document must belong to `installationId`, so another tenant's repositories are never listed.
 */
export async function listRepoAdminCandidates(
  db: Kysely<Database>,
  installationId: InstallationRowId,
  limit: number,
): Promise<RepoAdminCandidate[]> {
  const rows = await db
    .selectFrom('repositories')
    .innerJoin('installations', 'installations.id', 'repositories.installation_id')
    .select([
      'installations.github_installation_id',
      'repositories.github_repo_id',
      'repositories.full_name',
      'repositories.removed_at',
    ])
    .where('repositories.installation_id', '=', installationId)
    .where('repositories.removed_at', 'is', null)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('cla_documents')
          .select('cla_documents.id')
          .whereRef('cla_documents.repository_id', '=', 'repositories.id')
          .where('cla_documents.installation_id', '=', installationId),
      ),
    )
    .orderBy('repositories.id')
    .limit(limit)
    .execute();
  return rows;
}
