// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { expect, test } from 'vitest';
import {
  approve,
  corporateTenant,
  insertAgreement,
  insertApprovalRow,
  PEOPLE,
  personWithId,
  publishCorporateDocument,
  signCorporate,
  storeAgreementText,
  validUserRow,
} from './corporate-fixture/test-support.ts';
import { columnsHolding } from './erasure-fixture/test-support.ts';
import type { Database } from './schema.ts';
import { containing, migratedTestDatabase, publishVersion, seedTenant, sha256 } from './test-support.ts';

// Migration 020 (E21-S01), erase_signer_pii: the personal data of a signatory or an employee lives in corporate_agreement_pii and
// corporate_approval_pii, the erasure of the person in one installation deletes it there and nowhere else, and every core row
// stays. Personal data does not come back after an erasure.

const ACTOR = 9999;
const SIGNATORY = 501;
const NOT_FOUND = { code: 'P0002', message: containing('no user with that GitHub id') };
const RESTRICT = { code: '23001' };

const erase = (db: Kysely<Database>, githubId: number, installationId: number) =>
  sql<{ erased: number }>`select erase_signer_pii(${githubId}, ${ACTOR}, ${installationId}) as erased`
    .execute(db)
    .then(({ rows }) => rows);

/** Two tenants whose corporate agreements are signed by the same person (a lawyer of an agency) and approve the same employee. */
async function twoTenants() {
  const { db } = await migratedTestDatabase();
  const one = await corporateTenant(db, await seedTenant(db, 1), SIGNATORY, {
    companyName: 'First Company',
    signatoryTitle: 'First Title',
  });
  const two = await corporateTenant(db, await seedTenant(db, 2), SIGNATORY, {
    companyName: 'Second Company',
    signatoryTitle: 'Second Title',
  });
  return { db, one, two };
}

const texts = (db: Kysely<Database>) =>
  db
    .selectFrom('corporate_agreement_pii as p')
    .innerJoin('corporate_agreements as g', 'g.id', 'p.agreement_id')
    .select(['g.installation_id', 'p.company_name'])
    .orderBy('p.agreement_id')
    .execute();

const logins = (db: Kysely<Database>) =>
  db
    .selectFrom('corporate_approval_pii as p')
    .innerJoin('corporate_approvals as a', 'a.id', 'p.approval_id')
    .select(['a.installation_id', 'p.login'])
    .orderBy('a.installation_id')
    .orderBy('p.approval_id')
    .execute();

/** The four login snapshots {@link twoTenants} stores for a tenant, in the order of the approvals. */
const everythingOf = (installationId: number) =>
  ['login-501', 'acme-org', 'employee-login', 'derived-login'].map((login) => ({
    installation_id: installationId,
    login,
  }));

/** Every row of the four cores, as JSON, so that a test can show an erasure changed none of them. */
const cores = (db: Kysely<Database>) =>
  sql<{ rows: unknown }>`
    select jsonb_build_object(
      'agreements', (select jsonb_agg(to_jsonb(g) order by g.id) from corporate_agreements as g),
      'approvals', (select jsonb_agg(to_jsonb(a) order by a.id) from corporate_approvals as a),
      'signatures', (select jsonb_agg(to_jsonb(s) order by s.id) from signatures as s),
      'versions', (select jsonb_agg(to_jsonb(v) order by v.id) from cla_versions as v)) as rows`
    .execute(db)
    .then(({ rows }) => rows);

test('erasing a signatory in one tenant deletes the company text and the login snapshot of that tenant and keeps every core row', async () => {
  const { db, one, two } = await twoTenants();
  const before = await cores(db);

  expect(await erase(db, SIGNATORY, one.tenant.installationId)).toEqual([{ erased: 1 }]);

  expect(await texts(db)).toEqual([{ installation_id: two.tenant.installationId, company_name: 'Second Company' }]);
  expect(await logins(db)).toEqual([
    { installation_id: one.tenant.installationId, login: 'acme-org' },
    { installation_id: one.tenant.installationId, login: 'employee-login' },
    { installation_id: one.tenant.installationId, login: 'derived-login' },
    ...everythingOf(two.tenant.installationId),
  ]);
  expect(await cores(db)).toEqual(before);
});

test('erasing the signatory through their last tenant deletes the rest and scrubs the display snapshot', async () => {
  const { db, one, two } = await twoTenants();
  await erase(db, SIGNATORY, one.tenant.installationId);
  await erase(db, SIGNATORY, two.tenant.installationId);

  expect(await texts(db)).toEqual([]);
  expect((await logins(db)).map((row) => row.login)).not.toContain('login-501');
  const user = await db
    .selectFrom('users')
    .select(['login', 'name'])
    .where('github_id', '=', SIGNATORY)
    .executeTakeFirstOrThrow();
  expect(user).toEqual({ login: 'erased-501', name: null });
  expect(await db.selectFrom('signer_pii').select('signature_id').execute()).toEqual([]);
});

test('erasing an employee deletes the login snapshots of their approvals in that tenant, the derived one included, and no other', async () => {
  const { db, one, two } = await twoTenants();
  const before = await cores(db);

  expect(await erase(db, PEOPLE.employee, one.tenant.installationId)).toEqual([{ erased: 0 }]);
  expect(await erase(db, PEOPLE.derivedEmployee, one.tenant.installationId)).toEqual([{ erased: 0 }]);

  expect(await logins(db)).toEqual([
    { installation_id: one.tenant.installationId, login: 'login-501' },
    { installation_id: one.tenant.installationId, login: 'acme-org' },
    ...everythingOf(two.tenant.installationId),
  ]);
  expect(await texts(db)).toHaveLength(2);
  expect(await cores(db)).toEqual(before);
});

test('an employee who never signed in and is known only as the subject of an approval is erased, with a count of zero in the audit row', async () => {
  const { db, one } = await twoTenants();
  expect(await db.selectFrom('users').select('id').where('github_id', '=', PEOPLE.employee).execute()).toEqual([]);

  await erase(db, PEOPLE.employee, one.tenant.installationId);

  expect(
    await db
      .selectFrom('audit_log')
      .select(['installation_id', 'actor_github_id', 'action', 'subject_type', 'subject_id', 'metadata'])
      .execute(),
  ).toEqual([
    {
      installation_id: one.tenant.installationId,
      actor_github_id: ACTOR,
      action: 'signer_pii.erased',
      subject_type: 'user',
      subject_id: PEOPLE.employee,
      metadata: { signer_pii_rows: 0 },
    },
  ]);
});

test('a person no table of the installation knows is still refused, even when another installation approved them, and nothing changes', async () => {
  const { db } = await twoTenants();
  const third = await seedTenant(db, 3);
  const before = await cores(db);
  const loginsBefore = await logins(db);

  await expect(erase(db, PEOPLE.employee, third.installationId)).rejects.toMatchObject(NOT_FOUND);

  expect(await logins(db)).toEqual(loginsBefore);
  expect(await cores(db)).toEqual(before);
  expect(await db.selectFrom('audit_log').select('id').execute()).toEqual([]);
});

test('an org is no person: the id of an approved org alone is refused and its login snapshot stays', async () => {
  const { db, one } = await twoTenants();
  await expect(erase(db, PEOPLE.org, one.tenant.installationId)).rejects.toMatchObject(NOT_FOUND);
  expect((await logins(db)).filter((row) => row.login === 'acme-org')).toHaveLength(2);
});

test('the audit row of an erasure that reaches corporate data holds the count of signer_pii rows and nothing about the company or the logins', async () => {
  const { db, one } = await twoTenants();
  await erase(db, SIGNATORY, one.tenant.installationId);
  const audit = await db.selectFrom('audit_log').selectAll().execute();
  expect(audit).toHaveLength(1);
  expect(audit[0]?.metadata).toEqual({ signer_pii_rows: 1 });
  expect(JSON.stringify(audit)).not.toMatch(
    /First Company|First Title|acme-org|employee-login|login-501|acme\.example/u,
  );
});

test('no table of the application holds the company, the title or a login of a corporate agreement outside the three erasable columns, and after the erasure none holds them at all', async () => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db, 1);
  const sentinels = ['zzzz-company-77', 'zzzz-title-77', 'zzzz-employee-77', 'zzzz-org-77'];
  const corporate = await corporateTenant(db, tenant, SIGNATORY, {
    companyName: sentinels[0] ?? '',
    signatoryTitle: sentinels[1] ?? '',
  });
  await db
    .updateTable('corporate_approval_pii')
    .set({ login: sentinels[2] ?? '' })
    .where('approval_id', '=', corporate.employeeApproval)
    .execute();
  await db
    .updateTable('corporate_approval_pii')
    .set({ login: sentinels[3] ?? '' })
    .where('approval_id', '=', corporate.orgApproval)
    .execute();
  expect(await columnsHolding(db, sentinels)).toEqual([
    'corporate_agreement_pii.company_name',
    'corporate_agreement_pii.signatory_title',
    'corporate_approval_pii.login',
  ]);

  await erase(db, SIGNATORY, tenant.installationId);
  await erase(db, PEOPLE.employee, tenant.installationId);
  expect(await columnsHolding(db, sentinels)).toEqual(['corporate_approval_pii.login']);
  expect(await logins(db)).toEqual([
    { installation_id: tenant.installationId, login: 'zzzz-org-77' },
    { installation_id: tenant.installationId, login: 'derived-login' },
  ]);
});

test('the company text of an agreement signed before the signatory was erased is refused, that of another tenant and of a later signature is not', async () => {
  const { db } = await migratedTestDatabase();
  const one = await seedTenant(db, 1);
  const two = await seedTenant(db, 2);
  const person = await personWithId(db, SIGNATORY);
  const documentOne = await publishCorporateDocument(db, one);
  const documentTwo = await publishCorporateDocument(db, two);
  const pendingOne = await insertAgreement(db, one, documentOne, await signCorporate(db, one, documentOne, person));
  const pendingTwo = await insertAgreement(db, two, documentTwo, await signCorporate(db, two, documentTwo, person));

  await erase(db, SIGNATORY, one.installationId);

  await expect(storeAgreementText(db, pendingOne)).rejects.toMatchObject({
    ...RESTRICT,
    message: containing('the signatory of this agreement was erased'),
  });
  await storeAgreementText(db, pendingTwo);
  const text = 'Second corporate terms';
  const version = await publishVersion(db, documentOne.documentId, one.publisherId, { major: 2, minor: 0, text });
  const later = { ...documentOne, versionId: version.id, major: 2, contentSha256: sha256(text) };
  await storeAgreementText(db, await insertAgreement(db, one, later, await signCorporate(db, one, later, person)));
  expect((await texts(db)).map((row) => row.installation_id)).toEqual([two.installationId, one.installationId]);
});

test('an erasure audit row without an installation, as the first function wrote it, blocks the text of every tenant', async () => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db, 1);
  const document = await publishCorporateDocument(db, tenant);
  const pending = await insertAgreement(
    db,
    tenant,
    document,
    await signCorporate(db, tenant, document, await personWithId(db, SIGNATORY)),
  );
  await db
    .insertInto('audit_log')
    .values({
      installation_id: null,
      actor_github_id: ACTOR,
      action: 'signer_pii.erased',
      subject_type: 'user',
      subject_id: SIGNATORY,
      metadata: JSON.stringify({ signer_pii_rows: 1 }),
    })
    .execute();
  await expect(storeAgreementText(db, pending)).rejects.toMatchObject(RESTRICT);
});

test('the login snapshot of an approval made before the person was erased is refused, that of another tenant, of a later approval and of an org is not', async () => {
  const { db, one, two } = await twoTenants();
  const pending = (corporate: typeof one, githubId: number, kind: 'user' | 'github_org' = 'user') =>
    insertApprovalRow(db, { ...validUserRow(corporate, githubId), kind });
  const storeLogin = (approvalId: number) =>
    db.insertInto('corporate_approval_pii').values({ approval_id: approvalId, login: 'late' }).execute();
  const pendingHere = await pending(one, 8001);
  const pendingThere = await pending(two, 8001);
  const pendingOrg = await pending(one, 8002, 'github_org');

  await erase(db, 8001, one.tenant.installationId);
  await db
    .insertInto('audit_log')
    .values({
      installation_id: one.tenant.installationId,
      actor_github_id: ACTOR,
      action: 'signer_pii.erased',
      subject_type: 'user',
      subject_id: 8002,
      metadata: JSON.stringify({ signer_pii_rows: 0 }),
    })
    .execute();

  await expect(storeLogin(pendingHere)).rejects.toMatchObject({
    ...RESTRICT,
    message: containing('the person of this approval was erased'),
  });
  await storeLogin(pendingThere);
  await storeLogin(pendingOrg);

  await sql`update corporate_approvals set revoked_at = now() + interval '1 second', revoked_by = ${one.signed.person.userId} where id = ${pendingHere}`.execute(
    db,
  );
  const again = await approve(db, one.signed, {
    kind: 'user',
    githubId: 8001,
    login: 'again',
  });
  expect((await logins(db)).filter((row) => ['again', 'late'].includes(row.login))).toEqual([
    { installation_id: one.tenant.installationId, login: 'late' },
    { installation_id: one.tenant.installationId, login: 'again' },
    { installation_id: two.tenant.installationId, login: 'late' },
  ]);
  expect(again).toBeGreaterThan(pendingHere);
});
