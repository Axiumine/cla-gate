// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { anyDate, corporateTenant, storeAgreementText } from './corporate-fixture/test-support.ts';
import { containing, migratedTestDatabase, seedTenant } from './test-support.ts';

// Migration 020 (E21-S01), corporate_approvals after the insert: the only change is one revocation, and a row is never deleted. The
// revocation is prospective: it adds the three columns and leaves the rest of the row, and the agreement, as they were.

const RESTRICT = { code: '23001' };
const CHECK = { code: '23514' };
const UNIQUE = { code: '23505' };

async function world() {
  const { db } = await migratedTestDatabase();
  const corporate = await corporateTenant(db, await seedTenant(db, 1), 501);
  const manager = corporate.signed.person.userId;
  const revoke = (id: number, reason: string | null = null) =>
    db
      .updateTable('corporate_approvals')
      .set({ revoked_at: new Date(Date.now() + 1000), revoked_by: manager, revoke_reason: reason })
      .where('id', '=', id)
      .execute();
  return { db, corporate, manager, revoke };
}

test('an approval is revoked once: the three columns are set and the rest of the row is as it was', async () => {
  const { db, corporate, revoke } = await world();
  const before = await db
    .selectFrom('corporate_approvals')
    .selectAll()
    .where('id', '=', corporate.employeeApproval)
    .executeTakeFirstOrThrow();
  await revoke(corporate.employeeApproval, 'left the company');
  const after = await db
    .selectFrom('corporate_approvals')
    .selectAll()
    .where('id', '=', corporate.employeeApproval)
    .executeTakeFirstOrThrow();
  expect(after).toEqual({
    ...before,
    revoked_at: anyDate,
    revoked_by: corporate.signed.person.userId,
    revoke_reason: 'left the company',
  });
});

test('an approval can be revoked without a reason', async () => {
  const { db, corporate, revoke } = await world();
  await revoke(corporate.orgApproval);
  const row = await db
    .selectFrom('corporate_approvals')
    .select(['revoked_by', 'revoke_reason'])
    .where('id', '=', corporate.orgApproval)
    .executeTakeFirstOrThrow();
  expect(row).toEqual({ revoked_by: corporate.signed.person.userId, revoke_reason: null });
});

test('revoking an approval twice fails and the first revocation stands', async () => {
  const { db, corporate, revoke } = await world();
  await revoke(corporate.employeeApproval, 'first');
  await expect(revoke(corporate.employeeApproval, 'second')).rejects.toMatchObject({
    ...RESTRICT,
    message: containing('a revoked approval cannot be changed or un-revoked'),
  });
  const row = await db
    .selectFrom('corporate_approvals')
    .select('revoke_reason')
    .where('id', '=', corporate.employeeApproval)
    .executeTakeFirstOrThrow();
  expect(row.revoke_reason).toBe('first');
});

test.each([
  ['un-revoking', sql`update corporate_approvals set revoked_at = null, revoked_by = null, revoke_reason = null`],
  ['changing the reason', sql`update corporate_approvals set revoke_reason = 'other'`],
  ['revoking again later', sql`update corporate_approvals set revoked_at = now() + interval '1 day'`],
])('a revoked approval stays revoked: %s is refused', async (_attempt, statement) => {
  const { db, corporate, manager } = await world();
  await sql`update corporate_approvals set revoked_at = now(), revoked_by = ${manager}, revoke_reason = 'x' where id = ${corporate.ownApproval}`.execute(
    db,
  );
  await expect(sql`${statement} where id = ${corporate.ownApproval}`.execute(db)).rejects.toMatchObject({
    ...RESTRICT,
    message: containing('cannot be changed or un-revoked'),
  });
});

test.each([
  ['kind', sql`update corporate_approvals set kind = 'github_org'`],
  [
    'the numeric subject',
    sql`update corporate_approvals set subject_github_id = subject_github_id + 1 where subject_github_id is not null`,
  ],
  ['the domain', sql`update corporate_approvals set subject_domain = 'other.example' where subject_domain is not null`],
  ['the source', sql`update corporate_approvals set source = 'rule'`],
  ['the manager', sql`update corporate_approvals set approved_by = approved_by + 1 where approved_by is not null`],
  ['the time of the approval', sql`update corporate_approvals set approved_at = approved_at - interval '1 day'`],
  [
    'the expiry',
    sql`update corporate_approvals set expires_at = expires_at + interval '1 day' where expires_at is not null`,
  ],
  ['the agreement', sql`update corporate_approvals set agreement_id = agreement_id + 1`],
  ['the installation', sql`update corporate_approvals set installation_id = installation_id + 1`],
  [
    'the approval it derives from',
    sql`update corporate_approvals set derived_from_approval_id = id where derived_from_approval_id is not null`,
  ],
  [
    'a column together with a valid revocation',
    sql`update corporate_approvals set kind = 'github_org', revoked_at = now() + interval '1 day', revoked_by = approved_by where approved_by is not null`,
  ],
])('the core of an approval is immutable: %s cannot change', async (_column, statement) => {
  const { db } = await world();
  await expect(statement.execute(db)).rejects.toMatchObject({ ...RESTRICT, message: containing('only revoked_at') });
});

test.each([
  ['a no-op update', sql`update corporate_approvals set kind = kind`],
  ['setting only a reason', sql`update corporate_approvals set revoke_reason = 'x'`],
])('an update that does not revoke is refused: %s', async (_attempt, statement) => {
  const { db } = await world();
  await expect(statement.execute(db)).rejects.toMatchObject({
    ...RESTRICT,
    message: containing('only allowed to revoke'),
  });
});

test('a revocation needs both its time and its actor, and cannot precede the approval', async () => {
  const { db, corporate, manager } = await world();
  await expect(
    sql`update corporate_approvals set revoked_at = now() + interval '1 day' where id = ${corporate.ownApproval}`.execute(
      db,
    ),
  ).rejects.toMatchObject(CHECK);
  await expect(
    sql`update corporate_approvals set revoked_by = ${manager} where id = ${corporate.ownApproval}`.execute(db),
  ).rejects.toMatchObject(RESTRICT);
  await expect(
    sql`update corporate_approvals set revoked_at = approved_at - interval '1 day', revoked_by = ${manager} where id = ${corporate.ownApproval}`.execute(
      db,
    ),
  ).rejects.toMatchObject({ ...CHECK, message: containing('corporate_approvals_revocation_order_check') });
});

test('an approval can be neither deleted nor truncated, revoked or not', async () => {
  const { db, corporate, revoke } = await world();
  await revoke(corporate.employeeApproval);
  const rows = () => db.selectFrom('corporate_approvals').select('id').execute();
  const before = await rows();
  for (const statement of [
    sql`delete from corporate_approvals`,
    sql`delete from corporate_approvals where revoked_at is not null`,
    sql`truncate corporate_approvals cascade`,
  ]) {
    await expect(statement.execute(db)).rejects.toMatchObject({ ...RESTRICT, message: containing('is immutable') });
  }
  expect(await rows()).toEqual(before);
});

test('revoking an approval leaves its agreement, its signature and its login snapshot alone', async () => {
  const { db, corporate, revoke } = await world();
  const snapshot = () =>
    sql<{ agreement: unknown; signature: unknown; pii: unknown }>`
      select (select to_jsonb(g) from corporate_agreements as g) as agreement,
             (select to_jsonb(s) from signatures as s where s.id = ${corporate.signed.signatureId}) as signature,
             (select jsonb_agg(to_jsonb(p) order by p.approval_id) from corporate_approval_pii as p) as pii`.execute(
      db,
    );
  const before = (await snapshot()).rows;
  await revoke(corporate.employeeApproval);
  expect((await snapshot()).rows).toEqual(before);
});

test('the login snapshot of an approval and the text of an agreement belong to one row that exists, once, within their limits', async () => {
  const { db, corporate } = await world();
  await expect(storeAgreementText(db, corporate.signed.agreementId)).rejects.toMatchObject(UNIQUE);
  await expect(
    sql`insert into corporate_approval_pii (approval_id, login) values (${corporate.employeeApproval}, 'again')`.execute(
      db,
    ),
  ).rejects.toMatchObject(UNIQUE);
  await expect(
    sql`insert into corporate_approval_pii (approval_id, login) values (${corporate.domainApproval}, ${'x'.repeat(256)})`.execute(
      db,
    ),
  ).rejects.toMatchObject(CHECK);
  await expect(
    sql`insert into corporate_approval_pii (approval_id, login) values (${corporate.domainApproval}, '  ')`.execute(db),
  ).rejects.toMatchObject(CHECK);
  await expect(
    sql`insert into corporate_approval_pii (approval_id, login) values (987654, 'ghost')`.execute(db),
  ).rejects.toMatchObject({ code: '23503' });
});
