// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { Database } from '../../adapters/db/schema.ts';
import { twoTenants } from '../../adapters/db/tenant-fixture/test-support.ts';
import { migratedRuntimeDatabase, migratedTestDatabase, type TestDatabase } from '../../adapters/db/test-support.ts';
import { saveDraft } from '../cla-drafts.ts';
import { publishVersion } from '../cla-publish.ts';
import type { PublishedVersion, VersionPublish } from '../cla-publish-types.ts';
import { ClaRuleError } from '../cla-rule-error.ts';
import { createJobsTable, fakeEnqueuer } from '../jobs-fixture/test-support.ts';

// The world of the tests of publishing a version (E12-S04), below the routes: two tenants with the documents of `twoTenants`, a
// fake queue that writes into a test table on the transaction it is given, and the few helpers the tests share.
//
//   wide    the installation-wide document of tenant 1: version 1.0 active (`CLA_TEXT`, which is not canonical: no final line
//           feed), the signature of the tenant's signer at major 1, and no draft
//   scoped  the document of the repository `org-1/scoped`: no version, and a draft at revision 1

/**
 * The world of a test: the database, the tenant's scope, the person who publishes and the two documents. `open` is the database
 * the world is made in; the runtime tests pass {@link migratedRuntimeDatabase}, where the role `cla_app` exists and holds its grants.
 */
export async function publishWorld(open: () => Promise<TestDatabase> = migratedTestDatabase) {
  const { db } = await open();
  await createJobsTable(db);
  const seeded = await twoTenants(db);
  const scope = { installationId: seeded.t1.installationId };
  const admin = { id: seeded.people.admin1.userId, githubId: seeded.people.admin1.githubId };
  return {
    db,
    ...seeded,
    scope,
    admin,
    enqueuer: fakeEnqueuer(),
    wide: seeded.t1.documentId,
    scoped: seeded.t1.scoped.documentId,
  };
}

export type PublishWorld = Awaited<ReturnType<typeof publishWorld>>;

/** {@link publishWorld} in a database where the runtime role `cla_app` exists and holds its grants (E12-S04). */
export const runtimePublishWorld = (): Promise<PublishWorld> => publishWorld(migratedRuntimeDatabase);

/** A major bump of the draft at revision 1 of `documentId`, over the version the document points at now; `over` changes any part. */
export async function publication(
  world: PublishWorld,
  documentId: number,
  over: Partial<Omit<VersionPublish, 'documentId' | 'actor'>> = {},
): Promise<VersionPublish> {
  const document = await world.db
    .selectFrom('cla_documents')
    .select('active_version_id')
    .where('id', '=', documentId)
    .executeTakeFirstOrThrow();
  return {
    actor: world.admin,
    documentId,
    source: { type: 'draft', revision: 1 },
    bump: 'major',
    rationale: 'A reason',
    expectedActiveVersionId: document.active_version_id,
    acknowledgeResigning: false,
    ...over,
  };
}

/**
 * Saves `text` as the draft of `documentId` through the service (so it is canonical, as a real one is) and returns the revision
 * it is at: 1 when the document had none, else the one after the draft that was there.
 */
export async function draftWith(world: PublishWorld, documentId: number, text: string): Promise<number> {
  const existing = await world.db
    .selectFrom('cla_drafts')
    .select('revision')
    .where('document_id', '=', documentId)
    .executeTakeFirst();
  const saved = await saveDraft(world.db, world.scope, world.admin, {
    documentId,
    contentMd: text,
    expectedRevision: existing?.revision ?? null,
  });
  return saved.revision;
}

/** Saves `text` as the draft of `documentId` and publishes it with the bump, over the version the document points at now. */
export async function publishText(
  world: PublishWorld,
  documentId: number,
  text: string,
  over: Partial<Omit<VersionPublish, 'documentId' | 'actor'>> = {},
): Promise<PublishedVersion> {
  const revision = await draftWith(world, documentId, text);
  return publishVersion(
    world.db,
    world.scope,
    world.enqueuer,
    await publication(world, documentId, { source: { type: 'draft', revision }, ...over }),
  );
}

/** What a call broke: the rule and its details, or `null` when it broke none. Anything else is thrown. */
export async function brokenBy(attempt: Promise<unknown>): Promise<{ rule: string; details: unknown } | null> {
  try {
    await attempt;
    return null;
  } catch (error) {
    if (error instanceof ClaRuleError) {
      return { rule: error.rule, details: error.details };
    }
    throw error;
  }
}

/** Makes every insert into the audit log fail, so that what is written with an audit row can be shown to be written with it or not at all. */
export async function refuseAudit(db: Kysely<Database>): Promise<void> {
  await sql`create function fail_audit() returns trigger language plpgsql as $$ begin raise exception 'audit refused'; end $$`.execute(
    db,
  );
  await sql`create trigger fail_audit before insert on audit_log for each row execute function fail_audit()`.execute(
    db,
  );
}

/** Every version of a document, oldest number first, as the tests compare them. */
export async function versionsOf(db: Kysely<Database>, documentId: number) {
  return db
    .selectFrom('cla_versions')
    .select(['id', 'major', 'minor', 'content_md', 'content_sha256', 'published_by', 'rationale'])
    .where('document_id', '=', documentId)
    .orderBy('major')
    .orderBy('minor')
    .execute();
}

/** The version the document points at, as `major.minor`, or null when it has none. */
export async function activeNumberOf(db: Kysely<Database>, documentId: number): Promise<string | null> {
  const row = await db
    .selectFrom('cla_documents as d')
    .leftJoin('cla_versions as v', 'v.id', 'd.active_version_id')
    .select(['v.major', 'v.minor'])
    .where('d.id', '=', documentId)
    .executeTakeFirstOrThrow();
  return row.major === null ? null : `${row.major}.${row.minor}`;
}

/** Every version of a document with the transaction id of its row (`xmin`): a row that was updated, even to the value it had, gets a new one. Oldest id first. */
export async function versionRowsWithXmin(db: Kysely<Database>, documentId: number) {
  const { rows } = await sql<{ id: number; xmin: string; content_md: string; content_sha256: string }>`
    select id, xmin::text as xmin, content_md, content_sha256 from cla_versions where document_id = ${documentId} order by id`.execute(
    db,
  );
  return rows;
}

/**
 * A signature on the version `versionId` of the document, at `major`, by a new person (a new user row); `revoked` revokes it at
 * once. The world's own signature is the one on the first version of the installation-wide document.
 */
export async function addSignature(
  world: PublishWorld,
  spec: { readonly documentId: number; readonly versionId: number; readonly major: number; readonly revoked: boolean },
): Promise<void> {
  const githubId = 70_000 + (await world.db.selectFrom('users').select('id').execute()).length;
  const user = await world.db
    .insertInto('users')
    .values({ github_id: githubId, login: `login-${githubId}`, name: `Name ${githubId}`, avatar_url: null })
    .returning('id')
    .executeTakeFirstOrThrow();
  const version = await world.db
    .selectFrom('cla_versions')
    .select('content_sha256')
    .where('id', '=', spec.versionId)
    .executeTakeFirstOrThrow();
  await world.db
    .insertInto('signatures')
    .values({
      installation_id: world.t1.installationId,
      user_id: user.id,
      document_id: spec.documentId,
      version_id: spec.versionId,
      major: spec.major,
      content_sha256: version.content_sha256,
      consent_text_id: 'consent-v1',
      signer_type: 'individual',
      source_repository_id: world.t1.repositoryId,
      source_pr_number: 8,
    })
    .execute();
  if (spec.revoked) {
    await world.db
      .updateTable('signatures')
      .set({ revoked_at: sql`now()`, revoked_by: world.admin.id, revoke_reason: 'signer_request' })
      .where('user_id', '=', user.id)
      .execute();
  }
}
