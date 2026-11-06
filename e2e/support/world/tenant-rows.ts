// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../../../src/server/adapters/db/schema.ts';
import { activate, document } from './document-rows.ts';
import { DOCUMENTS, FOREIGN_TENANT, REPOSITORIES, SECOND_TENANT, TENANT } from './ids.ts';
import { at, insertRow } from './insert.ts';
import { installation, repository } from './installation-rows.ts';
import { ALICE, BOB } from './people.ts';
import { rowIdOf } from './people-rows.ts';
import { HOSTILE_DOCUMENT_NAME, TEXT_DRAFT } from './text.ts';
import { individualVersions, otherVersions, version } from './version-rows.ts';

// E18-S12: the tenants, repositories, documents and versions of the seeded world. The maintainer owns `alice-oss` and `alice-labs`
// (installations of a user account whose id is theirs: org admin with no call to GitHub); `bob-private` belongs to someone else.

/** The rows of the three tenants, their repositories and documents with their versions, the drafts and the attached documents. Call inside `withFixedHistory`. */
export async function seedTenants(db: Kysely<Database>): Promise<void> {
  const alice = await rowIdOf(db, ALICE);
  const bob = await rowIdOf(db, BOB);
  await installation(db, TENANT, ALICE.githubId);
  await installation(db, SECOND_TENANT, ALICE.githubId);
  await installation(db, FOREIGN_TENANT, BOB.githubId);
  for (const repo of [REPOSITORIES.widgets, REPOSITORIES.gadgets, REPOSITORIES.legacy]) {
    await repository(db, TENANT.id, repo);
  }
  await repository(db, SECOND_TENANT.id, REPOSITORIES.prototype);
  await repository(db, FOREIGN_TENANT.id, REPOSITORIES.vault);
  await document(db, TENANT.id, DOCUMENTS.individual);
  await document(db, TENANT.id, { id: DOCUMENTS.hostile.id, name: HOSTILE_DOCUMENT_NAME });
  await document(db, FOREIGN_TENANT.id, DOCUMENTS.foreign);
  for (const spec of [...individualVersions(alice), ...otherVersions(alice, bob)]) {
    await version(db, spec);
  }
  await activate(db);
  await insertRow(db, 'cla_drafts', {
    document_id: DOCUMENTS.individual.id,
    installation_id: TENANT.id,
    content_md: TEXT_DRAFT,
    revision: 3,
    updated_by: alice,
    updated_at: at('2026-03-18T16:20:00Z'),
  });
}
