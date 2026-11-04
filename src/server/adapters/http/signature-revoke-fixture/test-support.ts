// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { SIGNATURE_REVOKE_PATH, signatureRevokeResponseSchema } from '../../../../shared/signature-revoke.ts';
import { createJobsTable, fakeEnqueuer } from '../../../services/jobs-fixture/test-support.ts';
import type { JobEnqueuer } from '../../../services/ports/jobs.ts';
import type { PersonName } from '../../db/tenant-fixture/test-support.ts';
import { type DocumentWorld, documentWorld, parsed } from '../document-fixture/test-support.ts';
import { pointAt, publish } from '../repository-document-fixture/test-support.ts';

// The helpers of the tests of `POST .../signatures/:signatureId/revoke` (E15-S03), on the world of the documents tests: two tenants,
// five people, the real app on PGlite and a fake queue that writes into a test table on the transaction it is given. Tenant 1's
// signer (`member1`) signed the installation-wide document `Individual CLA`; its repositories `org-1/repo` and `org-1/scoped` are on.

/** The body of a revocation most tests send. */
export const MAINTAINER_DECISION = { reasonCode: 'maintainer_decision' } as const;

/** The path that revokes the signature `signatureId` (`signatures.id`) of the installation `installationId` (`installations.id`). */
export const revokePath = (installationId: number | string, signatureId: number | string): string =>
  SIGNATURE_REVOKE_PATH.replace(':installationId', String(installationId)).replace(':signatureId', String(signatureId));

/** The world of the revocation tests: the documents world with a queue (the fake one unless given) and its jobs table. */
export async function revokeWorld(enqueuer: JobEnqueuer = fakeEnqueuer()) {
  const world = await documentWorld({ enqueuer });
  await createJobsTable(world.db);
  return world;
}

/** Turns on both repositories of both tenants and points them at their tenant's installation-wide document, so every one of them enforces it. */
export async function enforceDocuments(world: DocumentWorld): Promise<void> {
  for (const tenant of [world.t1, world.t2]) {
    await world.db
      .updateTable('repositories')
      .set({ enabled: true, cla_document_id: tenant.documentId })
      .where('id', 'in', [tenant.plain.repositoryId, tenant.scoped.repositoryId])
      .execute();
  }
}

/** Revokes a signature as `who` with `body` as the body: `target` is the installation of the path and the signature. */
export function revokeWith(
  world: DocumentWorld,
  who: PersonName | null,
  target: { readonly installationId: number | string; readonly signatureId: number | string },
  body: object,
) {
  return world.ask(who, { method: 'POST', url: revokePath(target.installationId, target.signatureId), payload: body });
}

/** Revokes a signature as `who` with the maintainer's decision as the reason. */
export function revokeAs(
  world: DocumentWorld,
  who: PersonName | null,
  installationId: number | string,
  signatureId: number | string,
) {
  return revokeWith(world, who, { installationId, signatureId }, MAINTAINER_DECISION);
}

/** The answer of a call that succeeded, read with the shared schema. */
export const revokedAnswerOf = (response: { json: () => unknown }) => parsed(response, signatureRevokeResponseSchema);

/**
 * A signature on the repository-scoped document of tenant 1 (`org-1/scoped`, which gets its published version, once, and is pointed at
 * it): a new user, signed version 1.0. Its id.
 */
export async function scopedSignature(world: DocumentWorld, githubId = 6100): Promise<number> {
  const { t1 } = world;
  const document = await world.db
    .selectFrom('cla_documents')
    .select('active_version_id')
    .where('id', '=', t1.scoped.documentId)
    .executeTakeFirstOrThrow();
  if (document.active_version_id === null) {
    await publish(world, t1.scoped.documentId);
  }
  await pointAt(world, t1.scoped.repositoryId, t1.scoped.documentId);
  const user = await world.db
    .insertInto('users')
    .values({ github_id: githubId, login: `login-${githubId}`, name: null, avatar_url: null })
    .returning('id')
    .executeTakeFirstOrThrow();
  const version = await world.db
    .selectFrom('cla_versions')
    .select(['id', 'content_sha256'])
    .where('document_id', '=', t1.scoped.documentId)
    .executeTakeFirstOrThrow();
  const signature = await world.db
    .insertInto('signatures')
    .values({
      installation_id: t1.installationId,
      user_id: user.id,
      document_id: t1.scoped.documentId,
      version_id: version.id,
      major: 1,
      content_sha256: version.content_sha256,
      consent_text_id: 'consent-v1',
      signer_type: 'individual',
      source_repository_id: t1.scoped.repositoryId,
      source_pr_number: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return signature.id;
}

/** The row of a signature, with the revocation columns. */
export function signatureRow(world: DocumentWorld, signatureId: number) {
  return world.db.selectFrom('signatures').selectAll().where('id', '=', signatureId).executeTakeFirstOrThrow();
}

/**
 * Everything a signature row holds but its revocation columns, as the database renders it: the part of a signature that never
 * changes, so two readings of it are equal byte for byte (E15-S03).
 */
export async function signatureCore(world: DocumentWorld, signatureId: number): Promise<string> {
  const row = await world.db
    .selectFrom('signatures as s')
    .select(sql<string>`(to_jsonb(s) - 'revoked_at' - 'revoked_by' - 'revoke_reason')::text`.as('core'))
    .where('s.id', '=', signatureId)
    .executeTakeFirstOrThrow();
  return row.core;
}

/** The `signature.revoked` audit rows, oldest first. */
export function revokedAuditRows(world: DocumentWorld) {
  return world.db.selectFrom('audit_log').selectAll().where('action', '=', 'signature.revoked').orderBy('id').execute();
}
