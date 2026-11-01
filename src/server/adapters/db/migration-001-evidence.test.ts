// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { expect, test } from 'vitest';
import type { Database } from './schema.ts';
import {
  asRuntimeRole,
  CLA_TEXT,
  containing,
  migratedRuntimeDatabase,
  migratedTestDatabase,
  publishVersion,
  seedSignature,
  seedTenant,
  sha256,
  type Tenant,
} from './test-support.ts';

const CHECK = { code: '23514' };
const FOREIGN_KEY = { code: '23503' };
const RESTRICT = { code: '23001' };

async function corporateDocument() {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  const document = await db
    .insertInto('cla_documents')
    .values({
      installation_id: tenant.installationId,
      repository_id: null,
      name: 'Corporate CLA',
      kind: 'corporate',
      active_version_id: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const version = await publishVersion(db, document.id, tenant.publisherId, { major: 1, minor: 0, text: CLA_TEXT });
  return { db, tenant, document, version };
}

function signature(tenant: { installationId: number; publisherId: number }, documentId: number, versionId: number) {
  return {
    installation_id: tenant.installationId,
    user_id: tenant.publisherId,
    document_id: documentId,
    version_id: versionId,
    major: 1,
    content_sha256: sha256(CLA_TEXT),
    consent_text_id: 'consent',
  };
}

test('a signature has the signer type of its document, in both directions', async () => {
  const { db, tenant, document, version } = await corporateDocument();
  const individualOnCorporate = db
    .insertInto('signatures')
    .values({ ...signature(tenant, document.id, version.id), signer_type: 'individual' });
  await expect(individualOnCorporate.execute()).rejects.toMatchObject(FOREIGN_KEY);
  const corporateOnIndividual = db
    .insertInto('signatures')
    .values({ ...signature(tenant, tenant.documentId, tenant.versionId), signer_type: 'corporate' });
  await expect(corporateOnIndividual.execute()).rejects.toMatchObject(FOREIGN_KEY);
  await db
    .insertInto('signatures')
    .values({ ...signature(tenant, document.id, version.id), signer_type: 'corporate' })
    .execute();
});

test('a signature cannot be revoked before it was signed', async () => {
  const { db } = await migratedTestDatabase();
  await seedSignature(db, await seedTenant(db), 111);
  const early = sql`update signatures set revoked_at = signed_at - interval '1 second', revoked_by = user_id`;
  await expect(early.execute(db)).rejects.toMatchObject(CHECK);
  await sql`update signatures set revoked_at = signed_at, revoked_by = user_id`.execute(db);
});

const MINUTE = 60_000;

/** Inserts one row of `table` whose evidence timestamp is `offsetMs` away from now. */
function insertAt(db: Kysely<Database>, table: 'signatures' | 'cla_versions', tenant: Tenant, offsetMs: number) {
  const at = new Date(Date.now() + offsetMs);
  if (table === 'signatures') {
    return db
      .insertInto('signatures')
      .values({
        ...signature(tenant, tenant.documentId, tenant.versionId),
        signer_type: 'individual',
        signed_at: at,
      })
      .execute();
  }
  return db
    .insertInto('cla_versions')
    .values({
      document_id: tenant.documentId,
      major: 2,
      minor: 0,
      content_md: 'text',
      content_sha256: sha256('text'),
      published_by: tenant.publisherId,
      rationale: 'r',
      published_at: at,
    })
    .execute();
}

test.each([
  ['signatures', 'signed_at'],
  ['cla_versions', 'published_at'],
] as const)('%s.%s is the database clock, not a time the caller chooses', async (table, column) => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  for (const offset of [-1440 * MINUTE, -6 * MINUTE, 6 * MINUTE, 1440 * MINUTE]) {
    await expect(insertAt(db, table, tenant, offset)).rejects.toMatchObject({ ...CHECK, message: containing(column) });
  }
  await insertAt(db, table, tenant, -4 * MINUTE);
});

test.each([
  ['an address', 'please delete alice@example.com'],
  ['a sentence', 'The signer asked for it by email'],
  ['an unknown code', 'because'],
])('a revocation reason is a code, never free text: %s is refused', async (_case, reason) => {
  const { db } = await migratedTestDatabase();
  await seedSignature(db, await seedTenant(db), 111);
  const revoke = sql`update signatures set revoked_at = now(), revoked_by = user_id, revoke_reason = ${reason}`;
  await expect(revoke.execute(db)).rejects.toMatchObject(CHECK);
  expect(await db.selectFrom('signatures').select('revoked_at').execute()).toEqual([{ revoked_at: null }]);
});

test.each([['signer_request'], ['maintainer_decision'], ['legal_request'], ['other']])(
  'the revocation reason code %s is accepted',
  async (reason) => {
    const { db } = await migratedTestDatabase();
    await seedSignature(db, await seedTenant(db), 111);
    await sql`update signatures set revoked_at = now(), revoked_by = user_id, revoke_reason = ${reason}`.execute(db);
    expect(await db.selectFrom('signatures').select('revoke_reason').execute()).toEqual([{ revoke_reason: reason }]);
  },
);

async function publishedTwice() {
  const { db } = await migratedRuntimeDatabase();
  const tenant = await seedTenant(db);
  const v2 = await publishVersion(db, tenant.documentId, tenant.publisherId, {
    major: 2,
    minor: 0,
    text: 'Second major',
  });
  const activate = (versionId: number | null) =>
    asRuntimeRole(db, (trx) =>
      trx
        .updateTable('cla_documents')
        .set({ active_version_id: versionId })
        .where('id', '=', tenant.documentId)
        .execute(),
    );
  const active = async () =>
    (await db.selectFrom('cla_documents').select('active_version_id').executeTakeFirstOrThrow()).active_version_id;
  return { db, tenant, v2, activate, active };
}

test('the active version moves forward only: a rollback is a new version, never an old pointer', async () => {
  const { db, tenant, v2, activate, active } = await publishedTwice();
  await activate(v2.id);
  expect(await active()).toBe(v2.id);

  await expect(activate(tenant.versionId)).rejects.toMatchObject({
    ...RESTRICT,
    message: containing('highest published version'),
  });
  expect(await active()).toBe(v2.id);

  const rollback = await publishVersion(db, tenant.documentId, tenant.publisherId, {
    major: 3,
    minor: 0,
    text: CLA_TEXT,
  });
  await activate(rollback.id);
  expect(await active()).toBe(rollback.id);
});

test('only the highest published version can be activated, and the pointer can be cleared', async () => {
  const { db, tenant, v2, activate, active } = await publishedTwice();
  const v21 = await publishVersion(db, tenant.documentId, tenant.publisherId, { major: 2, minor: 1, text: 'Typo fix' });
  await expect(activate(v2.id)).rejects.toMatchObject({ ...RESTRICT, message: containing('highest') });
  await activate(v21.id);
  await activate(null);
  expect(await active()).toBeNull();
  await activate(v21.id);
  expect(await active()).toBe(v21.id);
});

const FORBIDDEN_METADATA = [
  ['a name key', { name: 'Alice' }],
  ['an email key', { email: 'alice@example.com' }],
  ['a login key', { login: 'alice' }],
  ['an avatar key', { avatar_url: 'https://avatars.example/u' }],
  ['a capitalised key', { Email: 'a@b.c' }],
  ['a nested object', { user: { email: 'a@b.c', name: 'A' } }],
  ['keys that merely contain a personal word', { actor_email: 'a@b.c', username: 'alice', full_name: 'A B' }],
  ['an array of addresses', { emails: ['a@b.c'] }],
  ['an address inside an allowed key', { reason_code: 'a@b.c' }],
  ['a sentence inside an allowed key', { reason_code: 'Alice Smith asked' }],
  ['a code that is too long', { reason_code: `a${'b'.repeat(64)}` }],
  ['an object inside an allowed key', { count: { n: 1 } }],
  ['an array inside an allowed key', { count: [1] }],
] as const;

test.each(FORBIDDEN_METADATA)('audit metadata refuses %s', async (_case, metadata) => {
  const { db } = await migratedTestDatabase();
  const json = JSON.stringify(metadata);
  await expect(
    sql`insert into audit_log (action, metadata) values ('x.y', ${json}::jsonb)`.execute(db),
  ).rejects.toMatchObject(CHECK);
});

test('audit metadata accepts numbers, booleans, null, codes and nothing at all', async () => {
  const { db } = await migratedTestDatabase();
  const allowed = [
    { count: 3, enabled: true, pr_number: null, reason_code: 'signer_request', kind: 'individual' },
    { signer_pii_rows: 0 },
    {},
  ];
  for (const metadata of allowed) {
    const json = JSON.stringify(metadata);
    await sql`insert into audit_log (action, metadata) values ('x.y', ${json}::jsonb)`.execute(db);
  }
  await sql`insert into audit_log (action) values ('x.z')`.execute(db);
  expect(await db.selectFrom('audit_log').select('id').execute()).toHaveLength(4);
});
