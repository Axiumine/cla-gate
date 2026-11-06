// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../../../src/server/adapters/db/schema.ts';
import { DOCUMENTS, FOREIGN_TENANT, REPOSITORIES, TENANT, VERSIONS } from './ids.ts';
import { at, insertRow, sha256Of } from './insert.ts';
import { ALICE, CAROL, DAN, ERIN, type Person } from './people.ts';
import { rowIdOf } from './people-rows.ts';
import { TEXT_OTHER, TEXT_V1, TEXT_V2 } from './text.ts';

// E18-S12: the signatures of the seeded tenants, with the personal data of each signer: one active, one outdated, one revoked, and
// one of the other tenant. Call inside `withFixedHistory`: the signatures are in the past.

interface SignatureSpec {
  readonly id: number;
  readonly signer: Person;
  readonly tenantId: number;
  readonly documentId: number;
  readonly versionId: number;
  readonly major: number;
  readonly text: string;
  readonly signedAt: string;
  readonly repositoryId: number;
  readonly pr: number;
}

async function signature(db: Kysely<Database>, spec: SignatureSpec): Promise<void> {
  const userId = await rowIdOf(db, spec.signer);
  await insertRow(db, 'signatures', {
    id: spec.id,
    installation_id: spec.tenantId,
    user_id: userId,
    document_id: spec.documentId,
    version_id: spec.versionId,
    major: spec.major,
    content_sha256: sha256Of(spec.text),
    consent_text_id: 'consent-v1',
    signer_type: 'individual',
    signed_at: at(spec.signedAt),
    source_repository_id: spec.repositoryId,
    source_pr_number: spec.pr,
  });
  await insertRow(db, 'signer_pii', {
    signature_id: spec.id,
    user_id: userId,
    name: spec.signer.name,
    email: spec.signer.emails[0]?.email ?? 'nobody@example.test',
    login: spec.signer.login,
    created_at: at(spec.signedAt),
  });
}

/** Revokes a signature of the seeded history: the one update the table allows, from "not revoked" to "revoked". */
async function revoke(db: Kysely<Database>, signatureId: number, by: Person, when: string): Promise<void> {
  const revokedBy = await rowIdOf(db, by);
  await db
    .updateTable('signatures')
    .set({
      revoked_at: at(when),
      revoked_by: revokedBy,
      revoke_reason: 'signer_request',
    })
    .where('id', '=', signatureId)
    .execute();
}

export async function seedSignatures(db: Kysely<Database>): Promise<void> {
  const individual = {
    tenantId: TENANT.id,
    documentId: DOCUMENTS.individual.id,
    repositoryId: REPOSITORIES.widgets.id,
  };
  await signature(db, {
    ...individual,
    id: 9401,
    signer: CAROL,
    versionId: VERSIONS.v2,
    major: 2,
    text: TEXT_V2,
    signedAt: '2026-03-12T10:00:00Z',
    pr: 17,
  });
  await signature(db, {
    ...individual,
    id: 9402,
    signer: DAN,
    versionId: VERSIONS.v1,
    major: 1,
    text: TEXT_V1,
    signedAt: '2026-01-20T08:30:00Z',
    pr: 5,
  });
  await signature(db, {
    ...individual,
    id: 9403,
    signer: ERIN,
    versionId: VERSIONS.v2,
    major: 2,
    text: TEXT_V2,
    signedAt: '2026-03-15T09:00:00Z',
    pr: 19,
  });
  await revoke(db, 9403, ALICE, '2026-04-02T11:00:00Z');
  await signature(db, {
    id: 9404,
    signer: CAROL,
    tenantId: FOREIGN_TENANT.id,
    documentId: DOCUMENTS.foreign.id,
    repositoryId: REPOSITORIES.vault.id,
    versionId: VERSIONS.foreign,
    major: 1,
    text: TEXT_OTHER,
    signedAt: '2026-02-01T13:00:00Z',
    pr: 3,
  });
}
