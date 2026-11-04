// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import type { NetworkMetadata } from './network-metadata.ts';

// The statements that record a signature (E13-S04), all called inside the one transaction of `recordSignature`. Each names the
// installation next to the ids, so a document, a version or a signature of another tenant is never written: the row is selected
// with the installation id in the WHERE clause, and the composite foreign keys of migration 001 hold the same line in the
// database. `signatures` is append-only (a trigger refuses every update but a revocation), and `signer_pii` holds the personal
// data, which no other table does.

/** What a new signature is made of: the person is `users.id`, the document and version are the ones the sign page showed. */
export interface NewSignature {
  readonly userId: number;
  readonly documentId: number;
  readonly versionId: number;
  readonly consentTextId: string;
  /** `repositories.id` of the repository the person came from, or `null`. */
  readonly sourceRepositoryId: number | null;
  readonly sourcePrNumber: number | null;
}

/** A signature as the answer names it. */
export interface StoredSignedSignature {
  readonly id: number;
  readonly versionId: number;
  readonly major: number;
  readonly minor: number;
  readonly signedAt: Date;
}

/**
 * What the personal data of a signature is made of: the name as cleaned, the address as GitHub reported it, the login snapshot
 * and, when the operator records it (E13-S05), the network metadata of the request.
 */
export interface NewSignerPii {
  readonly signatureId: number;
  readonly userId: number;
  readonly name: string;
  readonly email: string;
  readonly login: string;
  readonly network: NetworkMetadata;
}

/** Which signature is asked for: the person (`users.id`), the document and the major version. */
export interface LiveSignatureKey {
  readonly userId: number;
  readonly documentId: number;
  readonly major: number;
}

/**
 * Appends the signature of the person for the version of the document of the tenant, unless a signature that is not revoked
 * exists already for the person, the document and the major version of that version (the partial unique index
 * `signatures_active_unique`: `on conflict ... do nothing`, so the statement waits for a concurrent insert of the same key
 * and then writes nothing). `major` and `content_sha256` are copied from the version row, the type is `individual`, and the
 * time is the database's (`signed_at`'s default; a trigger refuses any other). A document or version of another tenant selects
 * no row and writes nothing.
 * @returns the new row, or `null` when nothing was written (the signature exists, or the document or version is not the tenant's).
 */
export async function insertSignature(
  db: Kysely<Database>,
  scope: TenantScope,
  input: NewSignature,
): Promise<{ readonly id: number; readonly signedAt: Date } | null> {
  const row = await db
    .insertInto('signatures')
    .columns([
      'installation_id',
      'user_id',
      'document_id',
      'version_id',
      'major',
      'content_sha256',
      'consent_text_id',
      'signer_type',
      'source_repository_id',
      'source_pr_number',
    ])
    .expression((eb) =>
      eb
        .selectFrom('cla_versions as v')
        .innerJoin('cla_documents as d', 'd.id', 'v.document_id')
        .select([
          'd.installation_id',
          eb.cast<number>(eb.val(input.userId), 'bigint').as('user_id'),
          'd.id as document_id',
          'v.id as version_id',
          'v.major',
          'v.content_sha256',
          eb.cast<string>(eb.val(input.consentTextId), 'text').as('consent_text_id'),
          eb.cast<'individual'>(eb.val('individual'), 'text').as('signer_type'),
          eb.cast<number | null>(eb.val(input.sourceRepositoryId), 'bigint').as('source_repository_id'),
          eb.cast<number | null>(eb.val(input.sourcePrNumber), 'integer').as('source_pr_number'),
        ])
        .where('d.installation_id', '=', scope.installationId)
        .where('d.id', '=', input.documentId)
        .where('v.id', '=', input.versionId),
    )
    .onConflict((conflict) =>
      conflict.columns(['user_id', 'document_id', 'major']).where('revoked_at', 'is', null).doNothing(),
    )
    .returning(['id', 'signed_at'])
    .executeTakeFirst();
  return row === undefined ? null : { id: row.id, signedAt: row.signed_at };
}

/**
 * Stores the personal data of a signature of the tenant. The row is selected from the signature with the installation id and the
 * person in the WHERE clause, so a signature of another tenant, or of another person, gets none.
 * @throws NoResultError when the tenant has no such signature of that person (the caller has just written it, so this is a defect).
 */
export async function insertSignerPii(db: Kysely<Database>, scope: TenantScope, input: NewSignerPii): Promise<void> {
  await db
    .insertInto('signer_pii')
    .columns(['signature_id', 'user_id', 'name', 'email', 'login', 'ip_address', 'user_agent'])
    .expression((eb) =>
      eb
        .selectFrom('signatures as s')
        .select([
          's.id as signature_id',
          's.user_id',
          eb.cast<string>(eb.val(input.name), 'text').as('name'),
          eb.cast<string>(eb.val(input.email), 'text').as('email'),
          eb.cast<string>(eb.val(input.login), 'text').as('login'),
          eb.cast<string | null>(eb.val(input.network.ipAddress), sql`inet`).as('ip_address'),
          eb.cast<string | null>(eb.val(input.network.userAgent), 'text').as('user_agent'),
        ])
        .where('s.installation_id', '=', scope.installationId)
        .where('s.id', '=', input.signatureId)
        .where('s.user_id', '=', input.userId),
    )
    .returning('signature_id')
    .executeTakeFirstOrThrow();
}

/**
 * The signature of the person for the document of the tenant at this major version that is not revoked (there is at most one),
 * with the version it was made under. It is what a repeated request answers with.
 * @throws NoResultError when there is none: the person has no live signature there, or it was revoked since the insert found it.
 */
export function findLiveSignature(
  db: Kysely<Database>,
  scope: TenantScope,
  which: LiveSignatureKey,
): Promise<StoredSignedSignature> {
  return db
    .selectFrom('signatures as s')
    .innerJoin('cla_versions as v', (join) =>
      join.onRef('v.id', '=', 's.version_id').onRef('v.document_id', '=', 's.document_id'),
    )
    .select(['s.id', 's.version_id as versionId', 's.major', 'v.minor', 's.signed_at as signedAt'])
    .where('s.installation_id', '=', scope.installationId)
    .where('s.user_id', '=', which.userId)
    .where('s.document_id', '=', which.documentId)
    .where('s.major', '=', which.major)
    .where('s.revoked_at', 'is', null)
    .executeTakeFirstOrThrow();
}
