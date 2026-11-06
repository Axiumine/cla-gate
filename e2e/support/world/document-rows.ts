// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../../../src/server/adapters/db/schema.ts';
import { DOCUMENTS, REPOSITORIES, VERSIONS } from './ids.ts';
import { at, insertRow } from './insert.ts';

// E18-S12: the CLA documents of the seeded tenants, and what makes them count: the version each one points at and the repositories
// that enforce it.

const CREATED = at('2026-01-05T09:00:00Z');

export async function document(
  db: Kysely<Database>,
  tenantId: number,
  doc: { readonly id: number; readonly name: string },
): Promise<void> {
  await insertRow(db, 'cla_documents', {
    id: doc.id,
    installation_id: tenantId,
    name: doc.name,
    kind: 'individual',
    created_at: CREATED,
    updated_at: CREATED,
  });
}

/** Points each document at its newest version, and attaches the documents to their repositories, and enables the ones that enforce. */
export async function activate(db: Kysely<Database>): Promise<void> {
  const active: readonly (readonly [number, number])[] = [
    [DOCUMENTS.individual.id, VERSIONS.v2],
    [DOCUMENTS.hostile.id, VERSIONS.hostile],
    [DOCUMENTS.foreign.id, VERSIONS.foreign],
  ];
  for (const [documentId, versionId] of active) {
    await db.updateTable('cla_documents').set({ active_version_id: versionId }).where('id', '=', documentId).execute();
  }
  const attached: readonly (readonly [number, number, boolean])[] = [
    [REPOSITORIES.widgets.id, DOCUMENTS.individual.id, true],
    [REPOSITORIES.legacy.id, DOCUMENTS.individual.id, false],
    [REPOSITORIES.vault.id, DOCUMENTS.foreign.id, true],
  ];
  for (const [repositoryId, documentId, enabled] of attached) {
    await db
      .updateTable('repositories')
      .set({ cla_document_id: documentId, enabled })
      .where('id', '=', repositoryId)
      .execute();
  }
}
