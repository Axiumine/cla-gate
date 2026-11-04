// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import { installationRowIdSchema } from '../../db/installation-row-id.ts';
import type { Database } from '../../db/schema.ts';
import { sha256 } from '../../db/test-support.ts';
import type { MatrixTarget } from '../cross-tenant-fixture/test-support.ts';

// What the cases of the cross-tenant matrix do to the database before a call that must succeed (`CrossTenantCase.prepare`): the
// states a request expects, put there whoever asks first. They live apart from the table of cases (cross-tenant-fixture) so that
// the table stays under the cap on the length of a file.

/** Brings the draft of the document of `target` to revision 1, saving one first when it has none: the save of the matrix names revision 1. */
export async function draftAtFirstRevision(db: Kysely<Database>, target: MatrixTarget): Promise<void> {
  const person = await db.selectFrom('users').select('id').orderBy('id').limit(1).executeTakeFirstOrThrow();
  await db
    .insertInto('cla_drafts')
    .values({
      document_id: target.documentId,
      installation_id: target.installationId,
      content_md: 'Matrix draft\n',
      updated_by: person.id,
    })
    .onConflict((conflict) => conflict.column('document_id').doUpdateSet({ revision: 1 }))
    .execute();
}

/** The body of a publish that succeeds now: the saved draft as a major version over the version the document points at (none: the first). */
export async function publishBody(db: Kysely<Database>, target: MatrixTarget): Promise<object> {
  const document = await db
    .selectFrom('cla_documents')
    .select('active_version_id')
    .where('id', '=', target.documentId)
    .executeTakeFirstOrThrow();
  return {
    source: { type: 'draft', revision: 1 },
    bump: 'major',
    rationale: 'Published by the matrix',
    expectedActiveVersionId: document.active_version_id,
    acknowledgeResigning: true,
  };
}

/** Gives the document of `target` its version 1.0 when it has none, and points the document at it, as a publish would leave it. */
export async function versionOne(db: Kysely<Database>, target: MatrixTarget): Promise<void> {
  const existing = await db
    .selectFrom('cla_versions')
    .select('id')
    .where('document_id', '=', target.documentId)
    .executeTakeFirst();
  if (existing !== undefined) {
    return;
  }
  const person = await db.selectFrom('users').select('id').orderBy('id').limit(1).executeTakeFirstOrThrow();
  const version = await db
    .insertInto('cla_versions')
    .values({
      document_id: target.documentId,
      major: 1,
      minor: 0,
      content_md: 'Matrix version\n',
      content_sha256: sha256('Matrix version\n'),
      published_by: person.id,
      rationale: 'Made for the matrix',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .updateTable('cla_documents')
    .set({ active_version_id: version.id })
    .where('id', '=', target.documentId)
    .execute();
}

/**
 * Makes the call of the attach case (and of the disable case, E14-S04) succeed whoever asks first: the repository of `target` is off (an
 * attach to an enforcing one sends a sweep, a disable of one a job, and the world has no queue) and the document is published (else `409`).
 */
export async function attachable(db: Kysely<Database>, target: MatrixTarget): Promise<void> {
  await versionOne(db, target);
  await db.updateTable('repositories').set({ enabled: false }).where('id', '=', target.repositoryId).execute();
}

/**
 * Makes the call of the enable case succeed whoever asks first (E14-S03): the repository of `target` enforces its own published CLA
 * already, so the call answers `changed: false` and sends no sweep (the world has no queue). The real change is shown by the tests
 * of the route (repository-enable-routes.test.ts).
 */
export async function enforcing(db: Kysely<Database>, target: MatrixTarget): Promise<void> {
  await versionOne(db, target);
  await db
    .updateTable('repositories')
    .set({ enabled: true, cla_document_id: target.documentId })
    .where('id', '=', target.repositoryId)
    .execute();
}

/**
 * Makes the add of an allowlist entry succeed whoever asks first (E14-S06): the add is `org_members`, which exists once per scope, so
 * the entries of the tenant that earlier calls left are removed; no repository of the tenant enforces the CLA, so the call sends no
 * sweep (the world has no queue); and the repository of `target` enforces the document of `target` (its own for the repository the
 * admin of a repository administers), so the role the call needs is the one the case expects. The sweeps are shown by the tests of
 * the routes (allowlist-entry-jobs.test.ts).
 */
export async function addable(db: Kysely<Database>, target: MatrixTarget): Promise<void> {
  const tenant = installationRowIdSchema.parse(target.installationId);
  await db.deleteFrom('allowlist_entries').where('installation_id', '=', tenant).execute();
  await db.updateTable('repositories').set({ enabled: false }).where('installation_id', '=', tenant).execute();
  await db
    .updateTable('repositories')
    .set({ cla_document_id: target.documentId })
    .where('id', '=', target.repositoryId)
    .execute();
}
