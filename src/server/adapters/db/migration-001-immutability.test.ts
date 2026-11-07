// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { containing, migratedTestDatabase, seedSignature, seedTenant } from './test-support.ts';

const RESTRICT = { code: '23001' };

async function seeded() {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  const signer = await seedSignature(db, tenant, 111);
  await db
    .insertInto('audit_log')
    .values({ action: 'cla.published', actor_github_id: 1, installation_id: tenant.installationId })
    .execute();
  return { db, tenant, signer };
}

// The message names the table whose trigger fired, so a dropped trigger cannot hide behind another table's.
test.each([
  ['UPDATE', sql`update cla_versions set rationale = 'changed'`, 'cla_versions is immutable: UPDATE'],
  ['DELETE', sql`delete from cla_versions`, 'cla_versions is immutable: DELETE'],
  [
    'TRUNCATE (with every table that references it, so the foreign keys do not object first)',
    sql`truncate cla_versions, cla_documents, cla_drafts, repositories, signatures, signer_pii, commit_overrides, allowlist_entries, pr_evaluations, merge_group_evaluations, corporate_agreements, corporate_agreement_pii, corporate_approvals, corporate_approval_pii`,
    'cla_versions is immutable: TRUNCATE',
  ],
  ['TRUNCATE of a parent table with CASCADE', sql`truncate cla_documents cascade`, 'is immutable: TRUNCATE'],
  ['TRUNCATE of users with CASCADE', sql`truncate users cascade`, 'is immutable: TRUNCATE'],
])('cla_versions rejects %s', async (_operation, statement, message) => {
  const { db } = await seeded();
  await expect(statement.execute(db)).rejects.toMatchObject({ ...RESTRICT, message: containing(message) });
  expect(await db.selectFrom('cla_versions').select('id').execute()).toHaveLength(1);
});

test.each([
  ['UPDATE', sql`update audit_log set action = 'forged.entry'`],
  ['DELETE', sql`delete from audit_log`],
  ['TRUNCATE', sql`truncate audit_log`],
  ['TRUNCATE of the parent table with CASCADE', sql`truncate installations cascade`],
])('audit_log rejects %s', async (_operation, statement) => {
  const { db } = await seeded();
  await expect(statement.execute(db)).rejects.toMatchObject({
    ...RESTRICT,
    message: containing('audit_log is immutable'),
  });
  expect(await db.selectFrom('audit_log').select('id').execute()).toHaveLength(1);
});

test('audit_log still accepts new rows', async () => {
  const { db } = await seeded();
  await db.insertInto('audit_log').values({ action: 'signature.revoked', actor_github_id: 2 }).execute();
  expect(await db.selectFrom('audit_log').select('id').execute()).toHaveLength(2);
});

test('signatures rejects DELETE, even when no signer_pii row holds a foreign key on it', async () => {
  const { db } = await seeded();
  await sql`delete from signer_pii`.execute(db);
  await expect(sql`delete from signatures`.execute(db)).rejects.toMatchObject({
    ...RESTRICT,
    message: containing('signatures is immutable: DELETE'),
  });
  expect(await db.selectFrom('signatures').select('id').execute()).toHaveLength(1);
});

test.each([
  [
    'TRUNCATE (with every table that references it)',
    sql`truncate signatures, signer_pii, corporate_agreements, corporate_agreement_pii, corporate_approvals, corporate_approval_pii`,
  ],
  ['TRUNCATE of users with CASCADE', sql`truncate users cascade`],
])('signatures rejects %s', async (_operation, statement) => {
  const { db } = await seeded();
  await expect(statement.execute(db)).rejects.toMatchObject({
    ...RESTRICT,
    message: containing('immutable: TRUNCATE'),
  });
  expect(await db.selectFrom('signatures').select('id').execute()).toHaveLength(1);
  expect(await db.selectFrom('signer_pii').select('signature_id').execute()).toHaveLength(1);
});

test.each([
  ['consent_text_id', sql`update signatures set consent_text_id = 'other'`],
  ['signed_at', sql`update signatures set signed_at = signed_at + interval '1 day'`],
  ['signer_type', sql`update signatures set signer_type = 'corporate'`],
  ['major', sql`update signatures set major = 2`],
  ['content_sha256', sql`update signatures set content_sha256 = repeat('0', 64)`],
  ['user_id', sql`update signatures set user_id = (select min(id) from users)`],
  ['version_id', sql`update signatures set version_id = version_id + 1`],
  ['installation_id', sql`update signatures set installation_id = installation_id + 1`],
  ['source_pr_number', sql`update signatures set source_pr_number = 8`],
  [
    'the core together with a valid revocation',
    sql`update signatures set consent_text_id = 'x', revoked_at = now(), revoked_by = user_id`,
  ],
])('the signature core is immutable: %s cannot change', async (_column, statement) => {
  const { db } = await seeded();
  await expect(statement.execute(db)).rejects.toMatchObject({
    ...RESTRICT,
    message: containing('only revoked_at'),
  });
});

test('a signature can be revoked once, and only the revocation columns change', async () => {
  const { db, tenant, signer } = await seeded();
  const before = await db.selectFrom('signatures').selectAll().executeTakeFirstOrThrow();
  const revokedAt = new Date(before.signed_at.getTime() + 60_000);
  await db
    .updateTable('signatures')
    .set({ revoked_at: revokedAt, revoked_by: tenant.publisherId, revoke_reason: 'signer_request' })
    .where('id', '=', signer.signatureId)
    .execute();
  const after = await db.selectFrom('signatures').selectAll().executeTakeFirstOrThrow();
  expect(after).toEqual({
    ...before,
    revoked_at: revokedAt,
    revoked_by: tenant.publisherId,
    revoke_reason: 'signer_request',
  });
});

test.each([
  ['un-revoking', sql`update signatures set revoked_at = null, revoked_by = null, revoke_reason = null`],
  ['changing the reason', sql`update signatures set revoke_reason = 'legal_request'`],
  ['revoking again later', sql`update signatures set revoked_at = now() + interval '1 day'`],
])('a revoked signature stays revoked: %s is refused', async (_attempt, statement) => {
  const { db, tenant } = await seeded();
  await sql`update signatures set revoked_at = now(), revoked_by = ${tenant.publisherId}, revoke_reason = 'other'`.execute(
    db,
  );
  await expect(statement.execute(db)).rejects.toMatchObject({
    ...RESTRICT,
    message: containing('cannot be changed or un-revoked'),
  });
});

test.each([
  ['a no-op update', sql`update signatures set consent_text_id = consent_text_id`],
  ['setting only a reason', sql`update signatures set revoke_reason = 'other'`],
])('an update that does not revoke is refused: %s', async (_attempt, statement) => {
  const { db } = await seeded();
  await expect(statement.execute(db)).rejects.toMatchObject({
    ...RESTRICT,
    message: containing('only allowed to revoke'),
  });
});

test('a revocation needs both its time and its actor', async () => {
  const { db, tenant } = await seeded();
  await expect(sql`update signatures set revoked_at = now()`.execute(db)).rejects.toMatchObject({ code: '23514' });
  await expect(sql`update signatures set revoked_by = ${tenant.publisherId}`.execute(db)).rejects.toMatchObject(
    RESTRICT,
  );
});
