// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { SIGNATURE_REVOKE_PATH } from '../../../../shared/signature-revoke.ts';
import { SIGNATURES_PATH } from '../../../../shared/signature-search.ts';
import { installationRowIdSchema } from '../../db/installation-row-id.ts';
import type { Database } from '../../db/schema.ts';
import type { CrossTenantCase, MatrixTarget } from '../cross-tenant-fixture/test-support.ts';

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

const revocationUrl = (installationId: number, signatureId: number): string =>
  SIGNATURE_REVOKE_PATH.replace(':installationId', String(installationId)).replace(':signatureId', String(signatureId));

/**
 * The cases of E15, keyed `METHOD path`. E15-S02: any role in the installation searches the signatures, each person the documents
 * their role reaches (a repository admin the ones scoped to a repository they administer), so the class is the one of the list of
 * repositories (E14-S01): the admin of a repository passes and nobody who holds a role is told `403`. E15-S03: the revocation of the
 * signature on the installation-wide document is an installation write (org admin only); `revocable` puts a signature that is not
 * revoked there, whoever asks first, and its URL is read after that. The role for a repository's own document, and the signature
 * of one tenant under the path of the other, are in signature-revoke-roles.test.ts and signature-revoke-tenants.test.ts.
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
};
