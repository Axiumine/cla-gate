// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { InstallationRowId } from '../../adapters/db/installation-row-id.ts';
import { insertEvaluation } from '../../adapters/db/pr-evaluation-links-fixture/test-support.ts';
import type { Database } from '../../adapters/db/schema.ts';
import type { TenantWorld } from '../../adapters/db/tenant-fixture/test-support.ts';

// The stored failures the tests of the evaluations a signature asks for (E13-S07) read: a helper that stores an evaluation row
// of a repository with the details a test chooses (`failureDetails` makes them).

/**
 * Makes the repositories of `tenant` that `which` names (`plain`: `org-<n>/repo`, `scoped`: `org-<n>/scoped`) enforce the tenant's
 * document, the one a signature of the tenant covers, so that their failed pull requests are the ones a signing looks for.
 */
export async function attachDocument(
  db: Kysely<Database>,
  tenant: TenantWorld,
  which: readonly ('plain' | 'scoped')[],
): Promise<void> {
  await db
    .updateTable('repositories')
    .set({ cla_document_id: tenant.documentId })
    .where(
      'id',
      'in',
      which.map((name) => (name === 'plain' ? tenant.plain : tenant.scoped).repositoryId),
    )
    .execute();
}

/** A head SHA of one hex digit repeated. */
export const headOf = (digit: string): string => digit.repeat(40);

/** The row to store: the pull request, its head (`aaaa...` by default), its result (a failure by default) and what the job stored. */
interface StoredFailure {
  readonly prNumber: number;
  readonly headSha?: string;
  readonly result?: 'failure' | 'success' | 'in_progress' | 'cancelled';
  readonly details: Readonly<Record<string, unknown>>;
  readonly updatedAt: Date;
}

/** Stores an evaluation of a repository of a tenant and answers its id. */
export function storeFailure(
  db: Kysely<Database>,
  repository: { readonly installationId: InstallationRowId; readonly repositoryId: number },
  spec: StoredFailure,
): Promise<number> {
  return insertEvaluation(db, repository, {
    prNumber: spec.prNumber,
    headSha: spec.headSha ?? headOf('a'),
    result: spec.result ?? 'failure',
    details: spec.details,
    updatedAt: spec.updatedAt,
  });
}
