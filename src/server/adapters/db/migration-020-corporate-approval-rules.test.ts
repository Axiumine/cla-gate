// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import {
  anyDate,
  approve,
  corporateTenant,
  DOMAIN,
  derive,
  insertApprovalRow,
  PEOPLE,
  personWithId,
  signAgreement,
  validUserRow,
} from './corporate-fixture/test-support.ts';
import { containing, migratedTestDatabase, seedTenant } from './test-support.ts';

// Migration 020 (E21-S01), the rules of corporate_approvals that are more than a CHECK: one active approval per subject, the
// composite foreign keys that keep a row inside its tenant and its agreement, the derivation guard, and the single revocation.

const CHECK = { code: '23514' };
const FOREIGN_KEY = { code: '23503' };
const UNIQUE = { code: '23505' };

/** Two tenants, each with a corporate agreement and approvals of every kind. */
async function twoCorporateTenants() {
  const { db } = await migratedTestDatabase();
  const one = await corporateTenant(db, await seedTenant(db, 1), 501);
  const two = await corporateTenant(db, await seedTenant(db, 2), 502);
  return { db, one, two };
}

/** The columns of an approval as the database reads them back: the numeric id or the domain, the source, an expiry for a rule. */
function stored(
  kind: 'user' | 'email_domain' | 'github_org',
  subject: number | string,
  source: 'manager' | 'rule' = 'manager',
) {
  return {
    kind,
    subject_github_id: typeof subject === 'number' ? subject : null,
    subject_domain: typeof subject === 'string' ? subject : null,
    source,
    expires_at: source === 'rule' ? anyDate : null,
    revoked_at: null,
  };
}

test('an approval of each kind is stored with the numeric id or the domain it names, and the login snapshots next to it', async () => {
  const { db, one } = await twoCorporateTenants();
  const rows = await db
    .selectFrom('corporate_approvals')
    .select(['kind', 'subject_github_id', 'subject_domain', 'source', 'expires_at', 'revoked_at'])
    .where('agreement_id', '=', one.signed.agreementId)
    .orderBy('id')
    .execute();
  expect(rows).toEqual([
    stored('user', 501),
    stored('email_domain', DOMAIN),
    stored('github_org', PEOPLE.org),
    stored('user', PEOPLE.employee),
    stored('user', PEOPLE.derivedEmployee, 'rule'),
  ]);
  const logins = await db
    .selectFrom('corporate_approval_pii as p')
    .innerJoin('corporate_approvals as a', 'a.id', 'p.approval_id')
    .select('p.login')
    .where('a.agreement_id', '=', one.signed.agreementId)
    .orderBy('p.approval_id')
    .execute();
  expect(logins.map((row) => row.login)).toEqual(['login-501', 'acme-org', 'employee-login', 'derived-login']);
});

test.each([
  ['a user', (id: number) => ({ kind: 'user' as const, githubId: id, login: 'again' })],
  ['an org', (id: number) => ({ kind: 'github_org' as const, githubId: id, login: 'again' })],
])('an agreement approves %s once while the approval is active', async (_case, subject) => {
  const { db, one } = await twoCorporateTenants();
  const approveAgain = (githubId: number) => approve(db, one.signed, subject(githubId));
  await approveAgain(8001);
  await expect(approveAgain(8001)).rejects.toMatchObject({
    ...UNIQUE,
    message: containing('corporate_approvals_active_unique'),
  });
});

test('a domain is approved once while the approval is active, and a revoked approval makes room for a new one', async () => {
  const { db, one } = await twoCorporateTenants();
  const again = () => approve(db, one.signed, { kind: 'email_domain', domain: DOMAIN });
  await expect(again()).rejects.toMatchObject(UNIQUE);
  await sql`update corporate_approvals set revoked_at = now(), revoked_by = ${one.signed.person.userId} where id = ${one.domainApproval}`.execute(
    db,
  );
  const replacement = await again();
  expect(replacement).toBeGreaterThan(one.domainApproval);
  await expect(again()).rejects.toMatchObject(UNIQUE);
});

test('the same subject is approved at once by another tenant, which the fixture does, by a second agreement, and by the same agreement as another kind', async () => {
  const { db, one, two } = await twoCorporateTenants();
  const employee = { githubId: PEOPLE.employee, login: 'shared-login' };
  const second = await signAgreement(db, one, await personWithId(db, 503));
  await approve(db, second, { kind: 'user', ...employee });
  await approve(db, one.signed, { kind: 'github_org', ...employee });
  const rows = await db
    .selectFrom('corporate_approvals')
    .select(['installation_id', 'agreement_id', 'kind'])
    .where('subject_github_id', '=', PEOPLE.employee)
    .orderBy('id')
    .execute();
  expect(rows).toEqual([
    { installation_id: one.tenant.installationId, agreement_id: one.signed.agreementId, kind: 'user' },
    { installation_id: two.tenant.installationId, agreement_id: two.signed.agreementId, kind: 'user' },
    { installation_id: one.tenant.installationId, agreement_id: second.agreementId, kind: 'user' },
    { installation_id: one.tenant.installationId, agreement_id: one.signed.agreementId, kind: 'github_org' },
  ]);
});

test('the active index is unique over the agreement, kind and subject and covers active rows only; the index of the evaluation covers them by tenant', async () => {
  const { db } = await twoCorporateTenants();
  const { rows } = await sql<{ indexname: string; indexdef: string }>`
    select indexname, indexdef from pg_indexes
    where schemaname = current_schema() and tablename = 'corporate_approvals' and indexname in ('corporate_approvals_active_unique', 'corporate_approvals_active_idx')
    order by indexname`.execute(db);
  expect(rows.map((row) => row.indexname)).toEqual([
    'corporate_approvals_active_idx',
    'corporate_approvals_active_unique',
  ]);
  expect(rows[0]?.indexdef).toMatch(/\(installation_id, agreement_id, kind\) WHERE \(revoked_at IS NULL\)$/u);
  expect(rows[0]?.indexdef).not.toMatch(/UNIQUE/u);
  expect(rows[1]?.indexdef).toMatch(
    /UNIQUE INDEX .*\(agreement_id, kind, subject_github_id, subject_domain\) NULLS NOT DISTINCT WHERE \(revoked_at IS NULL\)$/u,
  );
});

test('an approval cannot name the installation of one tenant and the agreement of another', async () => {
  const { db, one, two } = await twoCorporateTenants();
  const crossed = { ...validUserRow(one, 8101), installation_id: two.tenant.installationId };
  await expect(insertApprovalRow(db, crossed)).rejects.toMatchObject(FOREIGN_KEY);
  await expect(
    insertApprovalRow(db, { ...validUserRow(two, 8102), agreement_id: one.signed.agreementId }),
  ).rejects.toMatchObject(FOREIGN_KEY);
  await expect(insertApprovalRow(db, { ...validUserRow(one, 8103), agreement_id: 987_654 })).rejects.toMatchObject(
    FOREIGN_KEY,
  );
  expect(
    await db
      .selectFrom('corporate_approvals')
      .select('id')
      .where('subject_github_id', 'in', [8101, 8102, 8103])
      .execute(),
  ).toEqual([]);
});

test('a derived approval derives from an approval of the same agreement of the same tenant', async () => {
  const { db, one, two } = await twoCorporateTenants();
  const second = await signAgreement(db, one, await personWithId(db, 503));
  const secondDomain = await approve(db, second, {
    kind: 'email_domain',
    domain: 'second.example',
  });
  const deriveFrom = (parentId: number) => derive(db, one.signed, parentId, { githubId: 8201, login: 'x' });
  await expect(deriveFrom(two.domainApproval)).rejects.toMatchObject(FOREIGN_KEY);
  await expect(deriveFrom(secondDomain)).rejects.toMatchObject(FOREIGN_KEY);
  await expect(deriveFrom(987_654)).rejects.toMatchObject(FOREIGN_KEY);
  await deriveFrom(one.orgApproval);
  expect(
    await db.selectFrom('corporate_approvals').select('id').where('subject_github_id', '=', 8201).execute(),
  ).toHaveLength(1);
});

test('a derived approval cannot derive from a user approval or from a revoked approval', async () => {
  const { db, one } = await twoCorporateTenants();
  const deriveFrom = (parentId: number) => derive(db, one.signed, parentId, { githubId: 8301, login: 'x' });
  await expect(deriveFrom(one.employeeApproval)).rejects.toMatchObject({
    ...CHECK,
    message: containing('derives from an email_domain or github_org approval'),
  });
  await sql`update corporate_approvals set revoked_at = now(), revoked_by = ${one.signed.person.userId} where id = ${one.orgApproval}`.execute(
    db,
  );
  await expect(deriveFrom(one.orgApproval)).rejects.toMatchObject({
    ...CHECK,
    message: containing('cannot derive from a revoked approval'),
  });
  expect(
    await db.selectFrom('corporate_approvals').select('id').where('subject_github_id', '=', 8301).execute(),
  ).toEqual([]);
});
