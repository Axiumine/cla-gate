// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { Database } from '../../adapters/db/schema.ts';
import { seedTenant, type Tenant } from '../../adapters/db/test-support.ts';

// The world of the tests of the list of a person's own signatures (E13-S06): two tenants made by `seedTenant(db, 1)` and
// `seedTenant(db, 2)` on a migrated database, the people who sign (`users` rows by GitHub id), and the repositories a signature
// can send a person back to. Signatures themselves are stored with `seedSignatures` (export-fixture).

/** The GitHub id of the first person of the tests. */
export const ADA = 8800;

/** The GitHub id of the second person of the tests. */
export const BOB = 8801;

/** `users.id` of the person with this GitHub id. */
export async function userIdOf(db: Kysely<Database>, githubId: number): Promise<number> {
  const row = await db.selectFrom('users').select('id').where('github_id', '=', githubId).executeTakeFirstOrThrow();
  return row.id;
}

/** A second repository of the tenant, under this GitHub id, optionally enforcing the tenant's document and optionally removed. */
export async function addRepository(
  db: Kysely<Database>,
  tenant: Tenant,
  spec: { readonly githubRepoId: number; readonly enforcesDocument: boolean; readonly removed?: boolean },
): Promise<number> {
  const row = await db
    .insertInto('repositories')
    .values({
      installation_id: tenant.installationId,
      github_repo_id: spec.githubRepoId,
      full_name: `org/repo-${spec.githubRepoId}`,
      cla_document_id: spec.enforcesDocument ? tenant.documentId : null,
      removed_at: spec.removed === true ? new Date('2026-10-01T00:00:00Z') : null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Makes the repository `seedTenant` stores enforce the tenant's document (it enforces none to begin with). */
export async function enforceDocument(db: Kysely<Database>, tenant: Tenant): Promise<void> {
  await db
    .updateTable('repositories')
    .set({ cla_document_id: tenant.documentId })
    .where('id', '=', tenant.repositoryId)
    .execute();
}

/** Marks the installation of the tenant as suspended. */
export async function suspend(db: Kysely<Database>, tenant: Tenant): Promise<void> {
  await db
    .updateTable('installations')
    .set({ suspended_at: new Date('2026-10-20T00:00:00Z') })
    .where('id', '=', tenant.installationId)
    .execute();
}

/** Two tenants on a migrated database, `seedTenant(db, 1)` and `seedTenant(db, 2)`, with no signature but the ones a test stores. */
export async function twoSeededTenants(db: Kysely<Database>): Promise<{ readonly t1: Tenant; readonly t2: Tenant }> {
  return { t1: await seedTenant(db, 1), t2: await seedTenant(db, 2) };
}

/** The instant `2026-10-15T09:00:00.123xxxZ`, the digits being `micro` (0 to 999): the same millisecond for every number. */
const withinOneMillisecond = (micro: number): string => `2026-10-15T09:00:00.123${String(micro).padStart(3, '0')}Z`;

/**
 * Stores a signature of the person on the tenant's document and version 1.0 for each of `microseconds`, at the instant
 * `2026-10-15T09:00:00.123xxxZ` with the number (0 to 999) for the digits. So the signatures share one millisecond and differ by the
 * microsecond only, which a `Date` cannot tell apart. They are revoked a second later (the unique index lets a person have one
 * signature per document and major version that is not revoked, and these are several). The trigger that wants a current instant is
 * switched off for the statement and on again, as `seedSignatures` does. Answers the ids in the order given.
 */
export async function seedWithinOneMillisecond(
  db: Kysely<Database>,
  tenant: Tenant,
  githubId: number,
  microseconds: readonly number[],
): Promise<number[]> {
  const user = await db
    .insertInto('users')
    .values({ github_id: githubId, login: `login-${githubId}`, name: null, avatar_url: null })
    .onConflict((conflict) => conflict.column('github_id').doUpdateSet((eb) => ({ login: eb.ref('excluded.login') })))
    .returning('id')
    .executeTakeFirstOrThrow();
  await sql`alter table signatures disable trigger signatures_current_timestamp`.execute(db);
  try {
    const rows = await db
      .insertInto('signatures')
      .values(
        microseconds.map((micro) => ({
          installation_id: tenant.installationId,
          user_id: user.id,
          document_id: tenant.documentId,
          version_id: tenant.versionId,
          major: 1,
          content_sha256: tenant.contentSha256,
          consent_text_id: 'individual-v1',
          signer_type: 'individual' as const,
          signed_at: sql<Date>`${withinOneMillisecond(micro)}::timestamptz`,
          source_repository_id: tenant.repositoryId,
          source_pr_number: 7,
          revoked_at: sql<Date>`${withinOneMillisecond(micro)}::timestamptz + interval '1 second'`,
          revoked_by: user.id,
          revoke_reason: 'signer_request' as const,
        })),
      )
      .returning('id')
      .execute();
    return rows.map((row) => row.id);
  } finally {
    await sql`alter table signatures enable trigger signatures_current_timestamp`.execute(db);
  }
}
