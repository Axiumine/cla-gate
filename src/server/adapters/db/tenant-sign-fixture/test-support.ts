// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, NoResultError } from 'kysely';
import { findSignDocument, findSignRepository, listViewerSignatures } from '../../../services/sign-context-queries.ts';
import { findLiveSignature, insertSignature, insertSignerPii } from '../../../services/sign-record-queries.ts';
import type { Database } from '../schema.ts';
import type { TenantWorld } from '../tenant-fixture/test-support.ts';
import { ownersOfDocuments, ownersOfSignatures } from '../tenant-owners/test-support.ts';
import type { ScopedQuery, TenantQuery } from '../tenant-registry/test-support.ts';

// The registry entries (E11-S06) of the statements the sign page context runs over the tenant tables (E13-S02) and of the ones that
// record a signature (E13-S04). The seed gives each tenant a document with its version 1.0 and one signature of its own signer on
// it, so a statement that strays into the other tenant has a row to meet. They sit in a file of their own so that the registry
// stays under the size cap, as the entries of the exports do (`tenant-export-fixture`).

/** True for the error of a statement that selected no row of the tenant where the caller has just written or read one. */
const isNoResult = (error: unknown): boolean => error instanceof NoResultError;

/** The id of the signature the publisher of the tenant has on its document, as `arrangeUnsignedPublisher` stored it. */
async function publisherSignatureId(db: Kysely<Database>, ids: TenantWorld): Promise<number> {
  const row = await db
    .selectFrom('signatures')
    .select('id')
    .where('user_id', '=', ids.publisherId)
    .where('document_id', '=', ids.documentId)
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Gives the publisher of each tenant a signature of its document with no personal data: the row the personal data is stored for. */
async function arrangeUnsignedPublisher(db: Kysely<Database>, tenants: readonly TenantWorld[]): Promise<void> {
  for (const tenant of tenants) {
    await db
      .insertInto('signatures')
      .values({
        installation_id: tenant.installationId,
        user_id: tenant.publisherId,
        document_id: tenant.documentId,
        version_id: tenant.versionId,
        major: 1,
        content_sha256: tenant.contentSha256,
        consent_text_id: 'individual-v1',
        signer_type: 'individual',
      })
      .execute();
  }
}

/** A function that takes the tenant and the ids of a resource and answers with the rows of that tenant it read. */
const scoped = (options: Pick<ScopedQuery, 'run' | 'refusal' | 'arrange'>): ScopedQuery => ({
  kind: 'scoped',
  takesIds: true,
  activeOnly: false,
  ...options,
});

/** Every function of the sign context statements, by module and name. */
export const SIGN_TENANT_QUERIES: Readonly<Record<string, Readonly<Record<string, TenantQuery>>>> = {
  'services/sign-context-queries.ts': {
    findSignRepository: {
      kind: 'by_design',
      reason:
        "the sign link names a repository by GitHub's id and nothing else (E13-S02), so the tenant is found from it: the statement reads the one active repository under that id with the state of its installation and answers no list; the caller turns a tenant that is not served into the same 404 as an unknown repository",
      pinnedBy: 'services/sign-context-queries.test.ts',
      run: async (db, _scope, ids) => (await findSignRepository(db, ids.plain.githubRepoId))?.installationId,
      answers: (own, other) => ({ own: own.installationId, foreign: other.installationId }),
    },
    findSignDocument: scoped({
      run: async (db, scope, ids) => {
        const document = await findSignDocument(db, scope, ids.documentId);
        return document === null ? [] : ownersOfDocuments(db, [document.id]);
      },
    }),
    listViewerSignatures: scoped({
      run: async (db, scope, ids) => {
        const signatures = await listViewerSignatures(db, scope, ids.signer.userId, ids.documentId);
        return signatures.length === 0
          ? []
          : ownersOfSignatures(
              db,
              signatures.map((signature) => signature.id),
            );
      },
    }),
  },
  'services/sign-record-queries.ts': {
    insertSignature: scoped({
      // The publisher has not signed (the world's signer has), so the insert of the tenant's own call writes a row; the
      // document and version of another tenant select no row for this tenant, so the call writes nothing and answers `null`.
      run: async (db, scope, ids) => {
        const written = await insertSignature(db, scope, {
          userId: ids.publisherId,
          documentId: ids.documentId,
          versionId: ids.versionId,
          consentTextId: 'individual-v1',
          sourceRepositoryId: ids.plain.repositoryId,
          sourcePrNumber: 7,
        });
        return written === null ? [] : ownersOfSignatures(db, [written.id]);
      },
    }),
    insertSignerPii: scoped({
      // The signature of another tenant selects no row, which the caller (who has just written the signature) never meets.
      refusal: isNoResult,
      arrange: arrangeUnsignedPublisher,
      run: async (db, scope, ids) => {
        const signatureId = await publisherSignatureId(db, ids);
        await insertSignerPii(db, scope, {
          signatureId,
          userId: ids.publisherId,
          name: 'Registry Name',
          email: 'registry@example.test',
          login: 'registry-login',
        });
        return ownersOfSignatures(db, [signatureId]);
      },
    }),
    findLiveSignature: scoped({
      // The world's signer signed major 1 of the tenant's document; another tenant's document has no signature of theirs.
      refusal: isNoResult,
      run: async (db, scope, ids) => {
        const signature = await findLiveSignature(db, scope, {
          userId: ids.signer.userId,
          documentId: ids.documentId,
          major: 1,
        });
        return ownersOfSignatures(db, [signature.id]);
      },
    }),
  },
};
