// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';

// The counts of a tenant's repositories that the list of installations shows (E14-S01). The statement names the installation
// in its WHERE clause, so a repository of another tenant is never counted.

/** How many repositories a tenant has that are not removed, and how many of them enforce the CLA. */
export interface RepositoryCounts {
  readonly repositories: number;
  readonly enabled: number;
}

/** The counts of the tenant's repositories that are not removed: what the list of installations shows for each. */
export async function countRepositories(db: Kysely<Database>, scope: TenantScope): Promise<RepositoryCounts> {
  const row = await db
    .selectFrom('repositories')
    .select([
      sql<number>`count(*)::int`.as('repositories'),
      sql<number>`(count(*) filter (where enabled))::int`.as('enabled'),
    ])
    .where('installation_id', '=', scope.installationId)
    .where('removed_at', 'is', null)
    .executeTakeFirstOrThrow();
  return { repositories: row.repositories, enabled: row.enabled };
}
