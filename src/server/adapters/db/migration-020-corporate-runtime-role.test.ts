// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import {
  approve,
  corporateTenant,
  derive,
  PEOPLE,
  personWithId,
  publishCorporateDocument,
  signAgreement,
} from './corporate-fixture/test-support.ts';
import { asRuntimeRole, migratedRuntimeDatabase, seedTenant } from './test-support.ts';

// Migration 020 (E21-S01), the runtime role. The application connects as cla_app, which owns nothing: it inserts and reads the
// four corporate tables, revokes an approval and does nothing else to them. PGlite enforces privileges for a role switched to
// with SET ROLE like Postgres does, so this runs on both.

const DENIED = { code: '42501' };
const TABLES = [
  'corporate_agreements',
  'corporate_agreement_pii',
  'corporate_approvals',
  'corporate_approval_pii',
] as const;

async function withRuntimeRole() {
  const { db } = await migratedRuntimeDatabase();
  const tenant = await seedTenant(db, 1);
  const corporate = await corporateTenant(db, tenant, 501);
  return { db, tenant, corporate };
}

test.each(TABLES)(
  'cla_app may select from and insert into %s and may not delete, truncate or reference it',
  async (table) => {
    const { db } = await withRuntimeRole();
    const { rows } = await sql<{ privilege: string; granted: boolean }>`
    select p as privilege, has_table_privilege('cla_app', ${table}, p) as granted
    from unnest(array['select', 'insert', 'delete', 'truncate', 'references', 'trigger']) as p`.execute(db);
    expect(rows).toEqual([
      { privilege: 'select', granted: true },
      { privilege: 'insert', granted: true },
      { privilege: 'delete', granted: false },
      { privilege: 'truncate', granted: false },
      { privilege: 'references', granted: false },
      { privilege: 'trigger', granted: false },
    ]);
  },
);

test('cla_app may update the three revocation columns of corporate_approvals and no other column of the four tables', async () => {
  const { db } = await withRuntimeRole();
  const { rows } = await sql<{ name: string }>`
    select c.relname || '.' || a.attname as name
    from pg_attribute as a
    join pg_class as c on c.oid = a.attrelid
    where c.relnamespace = 'public'::regnamespace and c.relname = any(${sql.val([...TABLES])}) and a.attnum > 0
      and not a.attisdropped and has_column_privilege('cla_app', c.oid, a.attnum, 'update')
    order by name`.execute(db);
  expect(rows.map((row) => row.name)).toEqual([
    'corporate_approvals.revoke_reason',
    'corporate_approvals.revoked_at',
    'corporate_approvals.revoked_by',
  ]);
  const tables = await sql<{ granted: boolean }>`
    select has_table_privilege('cla_app', t, 'update') as granted from unnest(${sql.val([...TABLES])}::text[]) as t`.execute(
    db,
  );
  expect(tables.rows.map((row) => row.granted)).toEqual([false, false, false, false]);
});

test('the runtime role does the work of the stories: it signs an agreement, approves a domain and a user, derives an approval and revokes one', async () => {
  const { db } = await migratedRuntimeDatabase();
  const tenant = await seedTenant(db, 1);
  const document = await publishCorporateDocument(db, tenant);
  const manager = await personWithId(db, 501);
  const employee = { kind: 'user', githubId: PEOPLE.employee, login: 'employee-login' } as const;
  const approvalId = await asRuntimeRole(db, async (trx) => {
    const signed = await signAgreement(trx, { tenant, document }, manager);
    const domain = await approve(trx, signed, {
      kind: 'email_domain',
      domain: 'runtime.example',
    });
    await derive(trx, signed, domain, { githubId: PEOPLE.derivedEmployee, login: 'derived-login' });
    return approve(trx, signed, employee);
  });
  const revoked = await asRuntimeRole(db, (trx) =>
    trx
      .updateTable('corporate_approvals')
      .set({ revoked_at: new Date(Date.now() + 1000), revoked_by: manager.userId, revoke_reason: 'left' })
      .where('id', '=', approvalId)
      .where('installation_id', '=', tenant.installationId)
      .returning('id')
      .execute(),
  );
  expect(revoked).toEqual([{ id: approvalId }]);
  expect(await db.selectFrom('corporate_approval_pii').select('login').orderBy('approval_id').execute()).toEqual([
    { login: 'derived-login' },
    { login: 'employee-login' },
  ]);
});

test.each([
  ['DELETE on corporate_agreements', sql`delete from corporate_agreements`],
  ['UPDATE of corporate_agreements', sql`update corporate_agreements set major = major`],
  ['TRUNCATE of corporate_agreements', sql`truncate corporate_agreements`],
  ['DELETE on corporate_agreement_pii', sql`delete from corporate_agreement_pii`],
  ['UPDATE of corporate_agreement_pii', sql`update corporate_agreement_pii set company_name = 'x'`],
  ['TRUNCATE of corporate_agreement_pii', sql`truncate corporate_agreement_pii`],
  ['DELETE on corporate_approvals', sql`delete from corporate_approvals`],
  ['UPDATE of the kind of an approval', sql`update corporate_approvals set kind = kind`],
  [
    'UPDATE of the subject of an approval',
    sql`update corporate_approvals set subject_github_id = 1 where subject_github_id is not null`,
  ],
  [
    'UPDATE of the expiry of an approval',
    sql`update corporate_approvals set expires_at = now() + interval '9 years' where expires_at is not null`,
  ],
  ['TRUNCATE of corporate_approvals', sql`truncate corporate_approvals`],
  ['DELETE on corporate_approval_pii', sql`delete from corporate_approval_pii`],
  ['UPDATE of corporate_approval_pii', sql`update corporate_approval_pii set login = 'x'`],
  ['TRUNCATE of corporate_approval_pii', sql`truncate corporate_approval_pii`],
  ['disabling a trigger of corporate_approvals', sql`alter table corporate_approvals disable trigger all`],
  [
    'dropping a trigger of corporate_agreements',
    sql`drop trigger corporate_agreements_immutable on corporate_agreements`,
  ],
])('the runtime role cannot do %s', async (_operation, statement) => {
  const { db } = await withRuntimeRole();
  await expect(asRuntimeRole(db, (trx) => statement.execute(trx))).rejects.toMatchObject(DENIED);
  const intact = await sql<{ n: number }>`select count(*)::int as n from corporate_approval_pii`.execute(db);
  expect(intact.rows).toEqual([{ n: 4 }]);
});

test('the runtime role erases the corporate personal data of a person only through erase_signer_pii', async () => {
  const { db, tenant, corporate } = await withRuntimeRole();
  const erased = await asRuntimeRole(db, (trx) =>
    sql<{ n: number }>`select erase_signer_pii(${PEOPLE.employee}, 9999, ${tenant.installationId}) as n`.execute(trx),
  );
  expect(erased.rows).toEqual([{ n: 0 }]);
  const logins = await db.selectFrom('corporate_approval_pii').select('login').orderBy('approval_id').execute();
  expect(logins.map((row) => row.login)).toEqual(['login-501', 'acme-org', 'derived-login']);
  const signatory = await asRuntimeRole(db, (trx) =>
    sql<{ n: number }>`select erase_signer_pii(501, 9999, ${tenant.installationId}) as n`.execute(trx),
  );
  expect(signatory.rows).toEqual([{ n: 1 }]);
  expect(await db.selectFrom('corporate_agreement_pii').select('agreement_id').execute()).toEqual([]);
  expect(await db.selectFrom('corporate_agreements').select('id').execute()).toEqual([
    { id: corporate.signed.agreementId },
  ]);
});
