// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { INVALIDATION_PREVIEW_PATH, INVALIDATIONS_PATH } from '../../../../shared/signature-invalidate.ts';
import { SIGNATURE_REVOKE_PATH } from '../../../../shared/signature-revoke.ts';
import { SIGNATURES_PATH } from '../../../../shared/signature-search.ts';
import { installationRowIdSchema } from '../../db/installation-row-id.ts';
import type { Database } from '../../db/schema.ts';
import type { CrossTenantCase, MatrixTarget } from '../cross-tenant-fixture/test-support.ts';
import { versionOne } from '../cross-tenant-prepare/test-support.ts';

// The cases of the routes of epic E15 (revocation, overrides and pending pull requests) for the route matrix (E11-S06). They sit in a
// file of their own so that the fixture of the matrix stays under the size cap, as the cases of the sign routes do
// (`cross-tenant-sign-fixture`). The fixture spreads them into `CROSS_TENANT_CASES` before the erasure cases, which come last.

/**
 * Gives the tenant of `target` a signature that is not revoked on its installation-wide document, as a copy of the one the world
 * seeds (the same person, version and hash), unless one is there: the revocation of the case uses a signature up, and a revoked
 * row can never be edited, so the next call needs a new one. The copy carries no personal data (`signer_pii`), which the erasure
 * case at the end of the matrix counts.
 */
async function revocable(db: Kysely<Database>, target: MatrixTarget): Promise<void> {
  const tenant = installationRowIdSchema.parse(target.installationId);
  await sql`
    insert into signatures (installation_id, user_id, document_id, version_id, major, content_sha256, consent_text_id, signer_type)
    select installation_id, user_id, document_id, version_id, major, content_sha256, consent_text_id, signer_type
    from signatures where id = ${target.signatureId} and installation_id = ${tenant}
    on conflict (user_id, document_id, major) where revoked_at is null do nothing
  `.execute(db);
}

/** The URL that revokes the newest signature of the tenant of `target`, the one {@link revocable} left not revoked. */
async function newestRevocationUrl(db: Kysely<Database>, target: MatrixTarget): Promise<string> {
  const newest = await db
    .selectFrom('signatures')
    .select('id')
    .where('installation_id', '=', installationRowIdSchema.parse(target.installationId))
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirstOrThrow();
  return revocationUrl(target.installationId, newest.id);
}

const documentUrl = (path: string, target: MatrixTarget): string =>
  path.replace(':installationId', String(target.installationId)).replace(':documentId', String(target.documentId));

/** The GitHub ids of the signers the matrix makes up for the invalidation: far from the ones of the world, one more each time. */
let nextMatrixSigner = 880_000;

/** The signatures of the document of `target` that are in force at major 1. */
async function signaturesInForce(db: Kysely<Database>, target: MatrixTarget): Promise<number> {
  const row = await db
    .selectFrom('signatures')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('document_id', '=', target.documentId)
    .where('major', '=', 1)
    .where('revoked_at', 'is', null)
    .executeTakeFirstOrThrow();
  return row.n;
}

/**
 * Puts the document of `target` in the state the invalidation of its major 1 expects, whoever asks first (E15-S04): the document has its
 * version 1.0, no repository enforces it (the world has no queue, so a sweep could not be sent: the sweeps are shown by the tests of the
 * route), and one signature of a person made up for the purpose is in force, which the call before it used up.
 */
async function invalidatable(db: Kysely<Database>, target: MatrixTarget): Promise<void> {
  await versionOne(db, target);
  await db
    .updateTable('repositories')
    .set({ enabled: false })
    .where('cla_document_id', '=', target.documentId)
    .execute();
  nextMatrixSigner += 1;
  const person = await db
    .insertInto('users')
    .values({ github_id: nextMatrixSigner, login: `matrix-${nextMatrixSigner}`, name: null, avatar_url: null })
    .returning('id')
    .executeTakeFirstOrThrow();
  const version = await db
    .selectFrom('cla_versions')
    .select(['id', 'content_sha256'])
    .where('document_id', '=', target.documentId)
    .where('major', '=', 1)
    .executeTakeFirstOrThrow();
  await db
    .insertInto('signatures')
    .values({
      installation_id: installationRowIdSchema.parse(target.installationId),
      user_id: person.id,
      document_id: target.documentId,
      version_id: version.id,
      major: 1,
      content_sha256: version.content_sha256,
      consent_text_id: 'consent-v1',
      signer_type: 'individual',
    })
    .execute();
}

/** The body of an invalidation that succeeds now: major 1, held to the number of its signatures in force. */
async function invalidationBody(db: Kysely<Database>, target: MatrixTarget): Promise<object> {
  return { major: 1, reasonCode: 'maintainer_decision', expectedCount: await signaturesInForce(db, target) };
}

const revocationUrl = (installationId: number, signatureId: number): string =>
  SIGNATURE_REVOKE_PATH.replace(':installationId', String(installationId)).replace(':signatureId', String(signatureId));

/**
 * The cases of E15, keyed `METHOD path`. E15-S02: any role in the installation searches the signatures, each person the documents
 * their role reaches (a repository admin the ones scoped to a repository they administer), so the class is the one of the list of
 * repositories (E14-S01): the admin of a repository passes and nobody who holds a role is told `403`. E15-S03: the revocation of the
 * signature on the installation-wide document is an installation write (org admin only); `revocable` puts a signature that is not
 * revoked there, whoever asks first, and its URL is read after that. The role for a repository's own document, and the signature
 * of one tenant under the path of the other, are in signature-revoke-roles.test.ts and signature-revoke-tenants.test.ts. E15-S04: the
 * preview and the invalidation of a major follow the scope of the document, like the export of its signatures: the admin of a repository
 * passes for the repository's own document and an org admin for any (`document_read`, `document_write`); `invalidatable` puts one
 * signature in force on the document, whoever asks first, and the body names the count of that moment.
 */
export const REVOCATION_CASES: Readonly<Record<string, CrossTenantCase>> = {
  [`GET ${SIGNATURES_PATH}`]: {
    endpointClass: 'installation_role_read',
    request: (target) => ({
      method: 'GET',
      url: SIGNATURES_PATH.replace(':installationId', String(target.installationId)),
    }),
  },
  [`POST ${SIGNATURE_REVOKE_PATH}`]: {
    endpointClass: 'installation_write',
    prepare: revocable,
    urlFor: newestRevocationUrl,
    request: (target) => ({
      method: 'POST',
      url: revocationUrl(target.installationId, target.signatureId),
      payload: { reasonCode: 'maintainer_decision' },
    }),
  },
  [`GET ${INVALIDATION_PREVIEW_PATH}`]: {
    endpointClass: 'document_read',
    request: (target) => ({ method: 'GET', url: `${documentUrl(INVALIDATION_PREVIEW_PATH, target)}?major=1` }),
  },
  [`POST ${INVALIDATIONS_PATH}`]: {
    endpointClass: 'document_write',
    prepare: invalidatable,
    bodyFor: invalidationBody,
    request: (target) => ({
      method: 'POST',
      url: documentUrl(INVALIDATIONS_PATH, target),
      payload: { major: 1, reasonCode: 'maintainer_decision', expectedCount: 1 },
    }),
  },
};
