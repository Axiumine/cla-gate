// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { InstallationRowId } from './installation-row-id.ts';
import type { Database } from './schema.ts';

// The tenant of a piece of work (E11-S06). A data function over a tenant table takes the installation id as a required
// parameter and puts it in the WHERE clause of every statement it runs; in new code that parameter is a `TenantScope`.
// A tenant route hands the handler `request.tenant`, which has this shape, so a handler passes it on as it is.

/** The tenant a call acts for: `installations.id`, the surrogate key every tenant table points at, never GitHub's id. */
export interface TenantScope {
  readonly installationId: InstallationRowId;
}

/**
 * A repository that is not in the tenant of the work: another installation holds it, or no row has that id. Background
 * jobs throw it before any write, so work queued for one tenant can never change the rows of another. The message names
 * neither tenant nor repository: whoever logs it learns nothing about the other side.
 */
export class TenantMismatchError extends Error {
  override readonly name = 'TenantMismatchError';

  constructor() {
    super('the repository is not in this tenant');
  }
}

/**
 * Checks that the repository `repositoryId` (`repositories.id`) belongs to the tenant, a removed repository included
 * (its documents and signatures stay with the tenant that held it, E05-S06). The read carries the installation id, so
 * the row of another tenant is never seen, let alone returned. A job calls this before its first write.
 * @throws TenantMismatchError when the repository is another installation's, or does not exist.
 */
export async function assertRepositoryInTenant(
  db: Kysely<Database>,
  scope: TenantScope,
  repositoryId: number,
): Promise<void> {
  const row = await db
    .selectFrom('repositories')
    .select('id')
    .where('installation_id', '=', scope.installationId)
    .where('id', '=', repositoryId)
    .executeTakeFirst();
  if (row === undefined) {
    throw new TenantMismatchError();
  }
}
