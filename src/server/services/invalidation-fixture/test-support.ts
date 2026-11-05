// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../../adapters/db/schema.ts';
import type { TenantWorld } from '../../adapters/db/tenant-fixture/test-support.ts';
import { publishVersion, sha256 } from '../../adapters/db/test-support.ts';
import type { MajorInvalidation } from '../signature-invalidate.ts';

// The helpers of the tests of the invalidation of a major (E15-S04), on the world of the revocation tests (`revocationWorld`): the two
// tenants, whose repositories are on and enforce the tenant's installation-wide document, and a fake queue on the same database. They
// store signatures in bulk and a second major of a document past the services, and read signatures back.

/** A major of a document of a tenant, with the version the signatures made under it name. */
export interface SignedDocument {
  readonly installationId: number;
  readonly documentId: number;
  readonly versionId: number;
  readonly contentSha256: string;
  readonly major: number;
}

/** Major 1 of the installation-wide document of the tenant, which the world publishes and has its signer sign. */
export const majorOneOf = (tenant: TenantWorld): SignedDocument => ({
  installationId: tenant.installationId,
  documentId: tenant.documentId,
  versionId: tenant.versionId,
  contentSha256: tenant.contentSha256,
  major: 1,
});

/** Publishes version `major`.0 of the installation-wide document of `tenant`, past the services, and leaves the pointer where it is. */
export async function publishMajor(
  db: Kysely<Database>,
  tenant: TenantWorld,
  majorNumber: number,
): Promise<SignedDocument> {
  const text = `Major ${majorNumber} of the test document\n`;
  const version = await publishVersion(db, tenant.documentId, tenant.publisherId, {
    major: majorNumber,
    minor: 0,
    text,
  });
  return { ...majorOneOf(tenant), versionId: version.id, contentSha256: sha256(text), major: majorNumber };
}

/**
 * Stores `count` signatures of `document`, each by a new person (GitHub ids from `firstGithubId`), past the services, and answers the
 * ids of the signatures. The signatures carry no personal data.
 */
export async function addSignatures(
  db: Kysely<Database>,
  document: SignedDocument,
  count: number,
  firstGithubId: number,
): Promise<number[]> {
  const people = await db
    .insertInto('users')
    .values(
      Array.from({ length: count }, (_unused, index) => ({
        github_id: firstGithubId + index,
        login: `login-${firstGithubId + index}`,
        name: null,
        avatar_url: null,
      })),
    )
    .returning('id')
    .execute();
  const signatures = await db
    .insertInto('signatures')
    .values(
      people.map((person) => ({
        installation_id: document.installationId,
        user_id: person.id,
        document_id: document.documentId,
        version_id: document.versionId,
        major: document.major,
        content_sha256: document.contentSha256,
        consent_text_id: 'consent-v1',
        signer_type: 'individual' as const,
      })),
    )
    .returning('id')
    .execute();
  return signatures.map((signature) => signature.id);
}

/** The signatures of the document with the columns an invalidation sets, by id. */
export function signatureStates(db: Kysely<Database>, documentId: number) {
  return db
    .selectFrom('signatures')
    .select(['id', 'major', 'revoked_at', 'revoked_by', 'revoke_reason'])
    .where('document_id', '=', documentId)
    .orderBy('id')
    .execute();
}

/** The `signatures.invalidated` audit rows, oldest first. */
export function invalidationAuditRows(db: Kysely<Database>) {
  return db.selectFrom('audit_log').selectAll().where('action', '=', 'signatures.invalidated').orderBy('id').execute();
}

/** The invalidation of `document` by the admin of tenant 1 for the reason `maintainer_decision`, holding it to `expectedCount`. */
export function invalidationBy(
  tenant: TenantWorld,
  document: Pick<SignedDocument, 'documentId' | 'major'>,
  expectedCount: number,
): MajorInvalidation {
  return {
    ...document,
    reason: 'maintainer_decision',
    expectedCount,
    actor: { userId: tenant.admin.userId, githubId: tenant.admin.githubId },
  };
}
