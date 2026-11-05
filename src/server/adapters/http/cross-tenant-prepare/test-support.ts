// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
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

/** The commit the matrix records an override for (E15-S05): both tenants have it in both of their repositories, so one SHA is asked of each. */
export const MATRIX_COMMIT_SHA = '7'.repeat(40);

/**
 * Makes the recording of a commit override succeed whoever asks first (E15-S05): the repository of `target` enforces the document of
 * `target` (the role the call needs is the one that document asks for, as for the enable) and the overrides of the repository that
 * earlier calls left are removed (the one the world seeds stays), since the same commit cannot carry two (`409 override_exists`). No pull request of the tenant has
 * a failing evaluation, so the call sends no job (the world has no queue); the jobs are shown by the tests of the route
 * (commit-override-jobs.test.ts).
 */
export async function overridable(db: Kysely<Database>, target: MatrixTarget): Promise<void> {
  await enforcing(db, target);
  await db
    .deleteFrom('commit_overrides')
    .where('repository_id', '=', target.repositoryId)
    .where('commit_sha', '=', MATRIX_COMMIT_SHA)
    .execute();
}

/** The number of the last override {@link deletable} made up: the commit of the next one is one more, far from the commits of the worlds. */
let lastMatrixOverride = 0x7000_0000;

/**
 * Makes the removal of a commit override succeed whoever asks first (E15-S06): the repository of `target` enforces the document of
 * `target` (the role the call needs is the one that document asks for) and has an override of a commit made up for the purpose, which the
 * call before it used up. The override sits under an id the URL of the case cannot know, so the case reads it with {@link newestOverrideId}.
 * No pull request of the tenant has a result, so the call sends no job (the world has no queue); the jobs are shown by the tests of the
 * route (commit-override-remove-jobs.test.ts).
 */
export async function deletable(db: Kysely<Database>, target: MatrixTarget): Promise<void> {
  await enforcing(db, target);
  const person = await db.selectFrom('users').select('id').orderBy('id').limit(1).executeTakeFirstOrThrow();
  lastMatrixOverride += 1;
  await db
    .insertInto('commit_overrides')
    .values({
      installation_id: installationRowIdSchema.parse(target.installationId),
      repository_id: target.repositoryId,
      commit_sha: lastMatrixOverride.toString(16).padStart(40, '0'),
      created_by: person.id,
      reason: 'Made up by the matrix',
    })
    .execute();
}

/** The id of the newest override of the repository of `target`, the one {@link deletable} left. */
export async function newestOverrideId(db: Kysely<Database>, target: MatrixTarget): Promise<number> {
  const newest = await db
    .selectFrom('commit_overrides')
    .select('id')
    .where('repository_id', '=', target.repositoryId)
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirstOrThrow();
  return newest.id;
}

/**
 * Makes the add of an allowlist entry succeed whoever asks first (E14-S06): the add is `org_members`, which exists once per scope, so
 * the `org_members` entries of the tenant that earlier calls left are removed (the entries the world seeds stay: the removal of one is
 * a case of its own, E14-S07); no repository of the tenant enforces the CLA, so the call sends no
 * sweep (the world has no queue); and the repository of `target` enforces the document of `target` (its own for the repository the
 * admin of a repository administers), so the role the call needs is the one the case expects. The sweeps are shown by the tests of
 * the routes (allowlist-entry-jobs.test.ts).
 */
export async function addable(db: Kysely<Database>, target: MatrixTarget): Promise<void> {
  const tenant = installationRowIdSchema.parse(target.installationId);
  await db
    .deleteFrom('allowlist_entries')
    .where('installation_id', '=', tenant)
    .where('kind', '=', 'org_members')
    .execute();
  await db.updateTable('repositories').set({ enabled: false }).where('installation_id', '=', tenant).execute();
  await db
    .updateTable('repositories')
    .set({ cla_document_id: target.documentId })
    .where('id', '=', target.repositoryId)
    .execute();
}

/**
 * Lets the list of the allowlist of the repository of `target` be read by the person the role matrix names (E14-S07): the repository
 * enforces the document of `target` (its own for the repository the admin of a repository administers), and the role the call needs
 * is the one that document asks for.
 */
export async function listable(db: Kysely<Database>, target: MatrixTarget): Promise<void> {
  await db
    .updateTable('repositories')
    .set({ cla_document_id: target.documentId })
    .where('id', '=', target.repositoryId)
    .execute();
}

/**
 * Makes the removal of the entry of `target` succeed whoever asks first (E14-S07): the entry that covers the installation is there
 * under the id the case names (a call that removed it earlier is undone, in the same row of the same id), and no repository of the
 * tenant enforces the CLA, so the call sends no sweep (the world has no queue). The sweeps are shown by the tests of the route
 * (allowlist-entry-remove-jobs.test.ts).
 */
export async function removable(db: Kysely<Database>, target: MatrixTarget): Promise<void> {
  const tenant = installationRowIdSchema.parse(target.installationId);
  const person = await db.selectFrom('users').select('id').orderBy('id').limit(1).executeTakeFirstOrThrow();
  await sql`
    insert into allowlist_entries (id, installation_id, repository_id, kind, github_id, created_by)
    overriding system value
    values (${target.entryId}, ${tenant}, null, 'user', ${target.entryId + 1_000_000}, ${person.id})
    on conflict do nothing
  `.execute(db);
  await db.updateTable('repositories').set({ enabled: false }).where('installation_id', '=', tenant).execute();
}
