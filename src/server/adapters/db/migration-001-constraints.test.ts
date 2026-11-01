// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { expect, test } from 'vitest';
import type { Database } from './schema.ts';
import {
  CLA_TEXT,
  migratedTestDatabase,
  publishVersion,
  seedSignature,
  seedTenant,
  sha256,
  type Tenant,
} from './test-support.ts';

const UNIQUE = { code: '23505' };
const FOREIGN_KEY = { code: '23503' };
const CHECK = { code: '23514' };

function sign(
  db: Kysely<Database>,
  tenant: Tenant,
  userId: number,
  version: { id: number; major: number; text: string },
) {
  return db
    .insertInto('signatures')
    .values({
      installation_id: tenant.installationId,
      user_id: userId,
      document_id: tenant.documentId,
      version_id: version.id,
      major: version.major,
      content_sha256: sha256(version.text),
      consent_text_id: 'consent',
      signer_type: 'individual',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
}

test('one valid signature per person, document and major version', async () => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  const { userId } = await seedSignature(db, tenant, 111);
  const first = { id: tenant.versionId, major: 1, text: CLA_TEXT };
  await expect(sign(db, tenant, userId, first)).rejects.toMatchObject(UNIQUE);
});

test('after a revocation the same person can sign the same major again', async () => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  const { userId } = await seedSignature(db, tenant, 111);
  await sql`update signatures set revoked_at = now(), revoked_by = ${tenant.publisherId}`.execute(db);
  await sign(db, tenant, userId, { id: tenant.versionId, major: 1, text: CLA_TEXT });
  const rows = await db.selectFrom('signatures').select('revoked_at').orderBy('id').execute();
  expect(rows.map((row) => row.revoked_at === null)).toEqual([false, true]);
});

test('signing a new major version is allowed next to the old one; a minor revision of the same major is not a new signature', async () => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  const { userId } = await seedSignature(db, tenant, 111);
  const v2 = await publishVersion(db, tenant.documentId, tenant.publisherId, {
    major: 2,
    minor: 0,
    text: 'Second major',
  });
  await sign(db, tenant, userId, { id: v2.id, major: 2, text: 'Second major' });
  const v11 = await publishVersion(db, tenant.documentId, tenant.publisherId, { major: 1, minor: 1, text: 'Typo fix' });
  await expect(sign(db, tenant, userId, { id: v11.id, major: 1, text: 'Typo fix' })).rejects.toMatchObject(UNIQUE);
});

test.each([
  ['a different major than the version has', { major: 2 }],
  ['a different hash than the version has', { content_sha256: '0'.repeat(64) }],
  ['a version that does not exist', { version_id: 0 }],
  ['an installation that does not own the document', { installation_id: 999_999 }],
])('a signature cannot point at %s', async (_case, override) => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  const base = {
    installation_id: tenant.installationId,
    user_id: tenant.publisherId,
    document_id: tenant.documentId,
    version_id: tenant.versionId,
    major: 1,
    content_sha256: tenant.contentSha256,
    consent_text_id: 'c',
    signer_type: 'individual' as const,
  };
  await expect(
    db
      .insertInto('signatures')
      .values({ ...base, ...override })
      .execute(),
  ).rejects.toMatchObject(FOREIGN_KEY);
});

type Attempt = (db: Kysely<Database>, one: Tenant, two: Tenant) => Promise<unknown>;

const CROSS_TENANT: [string, Attempt][] = [
  [
    'a document in a repository of another tenant',
    (db, one, two) =>
      db
        .insertInto('cla_documents')
        .values({
          installation_id: one.installationId,
          repository_id: two.repositoryId,
          name: 'x',
          kind: 'individual',
          active_version_id: null,
        })
        .execute(),
  ],
  [
    'an evaluation of a repository of another tenant',
    (db, one, two) =>
      db
        .insertInto('pr_evaluations')
        .values({
          installation_id: one.installationId,
          repository_id: two.repositoryId,
          pr_number: 1,
          head_sha: 'a'.repeat(40),
          result: 'success',
        })
        .execute(),
  ],
  [
    'a commit override on a repository of another tenant',
    (db, one, two) =>
      db
        .insertInto('commit_overrides')
        .values({
          installation_id: one.installationId,
          repository_id: two.repositoryId,
          commit_sha: 'b'.repeat(40),
          created_by: one.publisherId,
          reason: 'r',
        })
        .execute(),
  ],
  [
    'an allowlist entry on a repository of another tenant',
    (db, one, two) =>
      db
        .insertInto('allowlist_entries')
        .values({
          installation_id: one.installationId,
          repository_id: two.repositoryId,
          kind: 'user',
          github_id: 5,
          created_by: one.publisherId,
        })
        .execute(),
  ],
  [
    'a signature of a version of another tenant',
    (db, one, two) => sign(db, one, one.publisherId, { id: two.versionId, major: 1, text: CLA_TEXT }),
  ],
  [
    'a signature that cites a source repository of another tenant',
    (db, one, two) =>
      db
        .insertInto('signatures')
        .values({
          installation_id: one.installationId,
          user_id: one.publisherId,
          document_id: one.documentId,
          version_id: one.versionId,
          major: 1,
          content_sha256: one.contentSha256,
          consent_text_id: 'c',
          signer_type: 'individual',
          source_repository_id: two.repositoryId,
        })
        .execute(),
  ],
  [
    'a default document of another tenant for a repository',
    (db, one, two) =>
      db
        .updateTable('repositories')
        .set({ cla_document_id: two.documentId })
        .where('id', '=', one.repositoryId)
        .execute(),
  ],
  [
    'an active version of another tenant for a document',
    (db, one, two) =>
      db
        .updateTable('cla_documents')
        .set({ active_version_id: two.versionId })
        .where('id', '=', one.documentId)
        .execute(),
  ],
];

test.each(CROSS_TENANT)(
  'tenants cannot reach into each other through composite foreign keys: %s',
  async (_label, attempt) => {
    const { db } = await migratedTestDatabase();
    const one = await seedTenant(db, 1);
    const two = await seedTenant(db, 2);
    await expect(attempt(db, one, two)).rejects.toMatchObject(FOREIGN_KEY);
  },
);

test('a signer_pii row belongs to the user who made the signature, nobody else', async () => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  const alice = await seedSignature(db, tenant, 111);
  const bob = await seedSignature(db, tenant, 222);
  const v2 = await publishVersion(db, tenant.documentId, tenant.publisherId, { major: 2, minor: 0, text: 'Second' });
  const second = await sign(db, tenant, alice.userId, { id: v2.id, major: 2, text: 'Second' });
  const pii = (userId: number) =>
    db.insertInto('signer_pii').values({
      signature_id: second.id,
      user_id: userId,
      name: 'N',
      email: 'e@example.test',
      login: 'l',
    });
  await expect(pii(bob.userId).execute()).rejects.toMatchObject(FOREIGN_KEY);
  await pii(alice.userId).execute();
});

test('the stored hash must be the SHA-256 of the stored text', async () => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  const wrong = db.insertInto('cla_versions').values({
    document_id: tenant.documentId,
    major: 2,
    minor: 0,
    content_md: 'text',
    content_sha256: sha256('other text'),
    published_by: tenant.publisherId,
    rationale: 'r',
  });
  await expect(wrong.execute()).rejects.toMatchObject(CHECK);
});

test('a version number can be published once per document', async () => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  await expect(
    publishVersion(db, tenant.documentId, tenant.publisherId, { major: 1, minor: 0, text: 'again' }),
  ).rejects.toMatchObject(UNIQUE);
});

test('webhook deliveries are idempotent on the delivery id', async () => {
  const { db } = await migratedTestDatabase();
  const delivery = { delivery_id: 'b1a2c3d4-0000-4000-8000-000000000001', event: 'pull_request', action: 'opened' };
  await db.insertInto('webhook_deliveries').values(delivery).execute();
  await expect(db.insertInto('webhook_deliveries').values(delivery).execute()).rejects.toMatchObject(UNIQUE);
  const again = await db
    .insertInto('webhook_deliveries')
    .values(delivery)
    .onConflict((oc) => oc.column('delivery_id').doNothing())
    .executeTakeFirst();
  expect(again.numInsertedOrUpdatedRows).toBe(0n);
});

test('one evaluation per repository, pull request and head commit', async () => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  const row = {
    installation_id: tenant.installationId,
    repository_id: tenant.repositoryId,
    pr_number: 3,
    head_sha: 'c'.repeat(40),
    result: 'in_progress' as const,
  };
  await db.insertInto('pr_evaluations').values(row).execute();
  await expect(db.insertInto('pr_evaluations').values(row).execute()).rejects.toMatchObject(UNIQUE);
  await db
    .insertInto('pr_evaluations')
    .values({ ...row, head_sha: 'd'.repeat(40) })
    .execute();
});

test('allowlist entries are unique per scope even when the repository is NULL', async () => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  const entry = {
    installation_id: tenant.installationId,
    repository_id: null,
    kind: 'bot' as const,
    github_id: 41_898_282,
    created_by: tenant.publisherId,
  };
  await db.insertInto('allowlist_entries').values(entry).execute();
  await expect(db.insertInto('allowlist_entries').values(entry).execute()).rejects.toMatchObject(UNIQUE);
  await db
    .insertInto('allowlist_entries')
    .values({ ...entry, repository_id: tenant.repositoryId })
    .execute();
});

test('one override per repository and commit', async () => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  const override = {
    installation_id: tenant.installationId,
    repository_id: tenant.repositoryId,
    commit_sha: 'e'.repeat(40),
    created_by: tenant.publisherId,
    reason: 'author email is not linked',
  };
  await db.insertInto('commit_overrides').values(override).execute();
  await expect(db.insertInto('commit_overrides').values(override).execute()).rejects.toMatchObject(UNIQUE);
});

test.each([
  [
    'an unknown account type',
    sql`insert into installations (github_installation_id, account_id, account_login, account_type) values (1, 1, 'x', 'Bot')`,
  ],
  ['a non-positive GitHub id', sql`insert into users (github_id, login) values (0, 'x')`],
  [
    'a CLA kind that does not exist',
    sql`insert into cla_documents (installation_id, name, kind) select id, 'n', 'other' from installations`,
  ],
  [
    'a PR evaluation result that does not exist',
    sql`insert into pr_evaluations (installation_id, repository_id, pr_number, head_sha, result) select installation_id, id, 1, repeat('a', 40), 'maybe' from repositories`,
  ],
  [
    'a commit hash that is not hex',
    sql`insert into commit_overrides (installation_id, repository_id, commit_sha, created_by, reason) select installation_id, id, repeat('z', 40), 1, 'r' from repositories`,
  ],
  [
    'an allowlist kind that does not exist',
    sql`insert into allowlist_entries (installation_id, kind, github_id, created_by) select installation_id, 'login', 1, 1 from repositories`,
  ],
  [
    'a session that expires idle after it expires absolutely',
    sql`insert into sessions (session_hash, user_id, csrf_secret, idle_expires_at, absolute_expires_at) select repeat('a', 64), id, 'c', now() + interval '2 days', now() + interval '1 day' from users`,
  ],
  [
    'a session hash that is not a SHA-256 digest',
    sql`insert into sessions (session_hash, user_id, csrf_secret, idle_expires_at, absolute_expires_at) select 'plain-cookie', id, 'c', now(), now() from users`,
  ],
  ['audit metadata that is not an object', sql`insert into audit_log (action, metadata) values ('x.y', '[]')`],
  ['an audit action with spaces', sql`insert into audit_log (action) values ('Signature Revoked')`],
  ['an audit subject type without its id', sql`insert into audit_log (action, subject_type) values ('x.y', 'user')`],
])('the schema rejects %s', async (_case, statement) => {
  const { db } = await migratedTestDatabase();
  await seedTenant(db);
  await expect(statement.execute(db)).rejects.toMatchObject(CHECK);
});

test('personal data columns exist only in signer_pii and the users snapshot (cla_documents.name is a document title)', async () => {
  const { db } = await migratedTestDatabase();
  const { rows } = await sql<{ table_name: string; column_name: string }>`
    select table_name, column_name from information_schema.columns
    where table_schema = 'public' and table_name <> 'schema_migrations' and column_name in ('name', 'email', 'login', 'avatar_url')
    order by table_name, column_name`.execute(db);
  expect(rows.map((row) => `${row.table_name}.${row.column_name}`)).toEqual([
    'cla_documents.name',
    'signer_pii.email',
    'signer_pii.login',
    'signer_pii.name',
    'users.avatar_url',
    'users.login',
    'users.name',
  ]);
});
