// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, NoResultError } from 'kysely';
import { failureDetails } from '../../../domain/failure-details-fixture/test-support.ts';
import { findFailingEvaluations } from '../../../services/failing-evaluation-queries.ts';
import { NO_NETWORK_METADATA } from '../../../services/network-metadata.ts';
import { ownSignatureRows } from '../../../services/own-signatures-queries.ts';
import { findSignDocument, findSignRepository, listViewerSignatures } from '../../../services/sign-context-queries.ts';
import { attachDocument, storeFailure } from '../../../services/sign-evaluations-fixture/test-support.ts';
import {
  findLiveSignature,
  insertCorporateSignature,
  insertSignature,
  insertSignerPii,
} from '../../../services/sign-record-queries.ts';
import type { Database } from '../schema.ts';
import { arrangeTo, corporateDocumentOf } from '../tenant-corporate-fixture/test-support.ts';
import type { TenantWorld } from '../tenant-fixture/test-support.ts';
import { ownersOfDocuments, ownersOfGithubIds, ownersOfSignatures } from '../tenant-owners/test-support.ts';
import type { ScopedQuery, TenantQuery } from '../tenant-registry/test-support.ts';

// The registry entries (E11-S06) of the statements the sign page context runs over the tenant tables (E13-S02), of the ones that
// record a signature (E13-S04) and of the list of a person's own signatures (E13-S06). The seed gives each tenant a document with its version 1.0 and one signature of its own signer on
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

/**
 * Makes the plain repository of each tenant enforce the tenant's document and gives it a pull request that fails for the tenant's
 * signer, so the lookup of the signer's failing pull requests (E13-S07) has a row of its own tenant to find and one of the other to stray into.
 */
async function arrangeFailingPullRequest(db: Kysely<Database>, tenants: readonly TenantWorld[]): Promise<void> {
  for (const tenant of tenants) {
    await attachDocument(db, tenant, ['plain']);
    await storeFailure(
      db,
      { installationId: tenant.installationId, repositoryId: tenant.plain.repositoryId },
      {
        prNumber: 61,
        details: failureDetails({ uncovered: [tenant.signer.githubId], documentId: tenant.documentId }),
        updatedAt: new Date('2026-06-01T00:00:00Z'),
      },
    );
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
  // The list of a person's own signatures (E13-S06) reads the person's rows in every tenant, on purpose: the reader is a signer and
  // belongs to no tenant. The statement names the person's own key and nothing else, so called for the signer of tenant 1 it finds
  // tenant 1's signature and for the signer of tenant 2 tenant 2's. The seed gives each tenant one signature by its own signer.
  'services/own-signatures-queries.ts': {
    ownSignatureRows: {
      kind: 'by_design',
      reason:
        "the list of a person's own signatures shows the person's signatures in every tenant (E13-S06); the person is a signer and belongs to no tenant, and the statement filters on the person's own key, which comes from the session, and on nothing the caller supplies",
      pinnedBy: 'services/own-signatures-queries.test.ts',
      run: async (db, _scope, ids) =>
        (await ownSignatureRows(db, ids.signer.userId, { limit: 10, from: null })).map((row) => row.id),
      answers: (own, other) => ({ own: [own.signatureId], foreign: [other.signatureId] }),
    },
  },
  // The signer's failing pull requests (E13-S07): the evaluations of the repositories attached to the document that list the
  // signer as uncovered. The world gives each tenant one, and a call for the other tenant's document or signer finds none.
  'services/failing-evaluation-queries.ts': {
    findFailingEvaluations: {
      kind: 'scoped',
      takesIds: true,
      activeOnly: true,
      arrange: arrangeFailingPullRequest,
      run: async (db, scope, ids) => {
        const rows = await findFailingEvaluations(db, scope, {
          documentId: ids.documentId,
          githubId: ids.signer.githubId,
          origin: null,
          limit: 10,
        });
        return ownersOfGithubIds(
          db,
          rows.map((row) => row.githubRepoId),
        );
      },
    },
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
    insertCorporateSignature: scoped({
      // The corporate document of another tenant selects no row for this tenant, which the caller (who has just read it) never meets.
      refusal: isNoResult,
      arrange: arrangeTo('document'),
      run: async (db, scope, ids) => {
        const document = await corporateDocumentOf(db, ids);
        const written = await insertCorporateSignature(db, scope, {
          userId: ids.publisherId,
          documentId: document.documentId,
          versionId: document.versionId,
          consentTextId: 'corporate-v1',
          sourceRepositoryId: ids.plain.repositoryId,
          sourcePrNumber: null,
        });
        return ownersOfSignatures(db, [written.id]);
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
          network: NO_NETWORK_METADATA,
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
