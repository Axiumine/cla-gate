// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { corporateTenant, PEOPLE } from '../../adapters/db/corporate-fixture/test-support.ts';
import { twoTenants } from '../../adapters/db/tenant-fixture/test-support.ts';
import { migratedTestDatabase } from '../../adapters/db/test-support.ts';
import { ownCorporateAgreements, ownCorporateApprovals } from './own-corporate-queries.ts';

// The statements of the export of a person's own data over the corporate CLA (E21): the agreements the person signed and the approvals that
// name them. Each one names the person's own key, reads every tenant and takes nothing else from the caller. The document is in
// adapters/http/data-export-corporate.test.ts.

/** Any text: the name of a document is not what this test pins. */
const ANY_STRING: unknown = expect.any(String);
const EMPLOYEE = parseGithubId(PEOPLE.employee);

/** Both tenants with a corporate agreement, signed in each by the signer of the first tenant, and the approvals of every kind. */
async function world() {
  const { db } = await migratedTestDatabase();
  const tenants = await twoTenants(db);
  const first = await corporateTenant(db, tenants.t1, tenants.t1.signer.githubId, {
    companyName: 'Acme Corp',
    signatoryTitle: 'Chief Legal Officer',
  });
  const second = await corporateTenant(db, tenants.t2, tenants.t1.signer.githubId, {
    companyName: 'Acme Europe',
    signatoryTitle: 'Director',
  });
  return { db, ...tenants, first, second };
}

test('ownCorporateAgreements: the agreements the person signed in every tenant, newest first, with the document, the major and the text they gave', async () => {
  const { db, t1, t2, first, second } = await world();
  const rows = await ownCorporateAgreements(db, t1.signer.userId);
  expect(rows.map((row) => row.id)).toEqual([second.signed.agreementId, first.signed.agreementId]);
  expect(rows.map((row) => [row.signature_id, row.github_installation_id, row.account_login])).toEqual([
    [second.signed.signatureId, t2.githubInstallationId, 'org-2'],
    [first.signed.signatureId, t1.githubInstallationId, 'org-1'],
  ]);
  expect(rows[1]).toMatchObject({
    document_id: first.document.documentId,
    document_name: ANY_STRING,
    major: first.document.major,
    revoked_at: null,
    personal_data: { company_name: 'Acme Corp', signatory_title: 'Chief Legal Officer' },
  });
  expect(rows[1]?.signed_at).toBeInstanceOf(Date);
  expect(rows[0]?.personal_data).toEqual({ company_name: 'Acme Europe', signatory_title: 'Director' });
});

test('ownCorporateAgreements: nobody else has a row, whether they signed nothing or only approve people, and an approved employee is not a signatory', async () => {
  const { db, t2 } = await world();
  expect(await ownCorporateAgreements(db, t2.signer.userId)).toEqual([]);
  expect(await ownCorporateAgreements(db, 987_654)).toEqual([]);
});

test('ownCorporateAgreements: the text is null once erased and the revocation of the signature shows, the agreement staying', async () => {
  const { db, t1, first, second } = await world();
  await sql`delete from corporate_agreement_pii where agreement_id = ${first.signed.agreementId}`.execute(db);
  await sql`update signatures set revoked_at = now(), revoked_by = ${t1.signer.userId}, revoke_reason = 'other'
    where id = ${second.signed.signatureId}`.execute(db);
  const rows = await ownCorporateAgreements(db, t1.signer.userId);
  expect(rows.map((row) => [row.id, row.personal_data, row.revoked_at !== null])).toEqual([
    [second.signed.agreementId, { company_name: 'Acme Europe', signatory_title: 'Director' }, true],
    [first.signed.agreementId, null, false],
  ]);
});

test('ownCorporateApprovals: the approvals of kind user that name the person in every tenant, newest first, with where they came from and their login', async () => {
  const { db, t1, t2, first, second } = await world();
  const rows = await ownCorporateApprovals(db, EMPLOYEE);
  expect(rows.map((row) => row.id)).toEqual([second.employeeApproval, first.employeeApproval]);
  expect(rows.map((row) => [row.agreement_id, row.github_installation_id, row.account_login])).toEqual([
    [second.signed.agreementId, t2.githubInstallationId, 'org-2'],
    [first.signed.agreementId, t1.githubInstallationId, 'org-1'],
  ]);
  expect(rows[1]).toMatchObject({
    source: 'manager',
    major: first.document.major,
    document_id: first.document.documentId,
    login: 'employee-login',
    expires_at: null,
    revoked_at: null,
  });
  expect(rows[1]?.approved_at).toBeInstanceOf(Date);
});

test('ownCorporateApprovals: an approval derived by a rule carries its source and when it expires, and the signatory is approved by themselves as anyone', async () => {
  const { db, t1, first, second } = await world();
  const derived = await ownCorporateApprovals(db, parseGithubId(PEOPLE.derivedEmployee));
  expect(derived.map((row) => [row.id, row.source, row.expires_at instanceof Date])).toEqual([
    [second.derivedApproval, 'rule', true],
    [first.derivedApproval, 'rule', true],
  ]);
  const signatory = await ownCorporateApprovals(db, t1.signer.githubId);
  expect(signatory.map((row) => [row.id, row.source])).toEqual([
    [second.ownApproval, 'manager'],
    [first.ownApproval, 'manager'],
  ]);
});

test('ownCorporateApprovals: no row for an organisation or a domain, for a number nobody is approved under, or for the other approvals of a tenant', async () => {
  const { db } = await world();
  expect(await ownCorporateApprovals(db, parseGithubId(PEOPLE.org))).toEqual([]);
  expect(await ownCorporateApprovals(db, parseGithubId(987_654))).toEqual([]);
  const all = await sql<{ n: string }>`select count(*)::text as n from corporate_approvals`.execute(db);
  expect(all.rows[0]?.n).toBe('10');
  expect(await ownCorporateApprovals(db, EMPLOYEE)).toHaveLength(2);
});

test('ownCorporateApprovals: the login is null once erased and a revoked approval still shows, with the instant of its revocation', async () => {
  const { db, t1, first, second } = await world();
  await sql`delete from corporate_approval_pii where approval_id = ${first.employeeApproval}`.execute(db);
  await sql`update corporate_approvals set revoked_at = now() + interval '1 minute', revoked_by = ${t1.signer.userId},
    revoke_reason = 'zzzz typed by the manager' where id = ${second.employeeApproval}`.execute(db);
  const rows = await ownCorporateApprovals(db, EMPLOYEE);
  expect(rows.map((row) => [row.id, row.login, row.revoked_at !== null])).toEqual([
    [second.employeeApproval, 'employee-login', true],
    [first.employeeApproval, null, false],
  ]);
});

test('neither statement selects who approved, who revoked or the text of a reason: other people, and a note typed by one', async () => {
  const { db, t1 } = await world();
  const agreement = await ownCorporateAgreements(db, t1.signer.userId);
  const approval = await ownCorporateApprovals(db, EMPLOYEE);
  const columns = [...agreement, ...approval].flatMap((row) => Object.keys(row));
  expect(
    columns.filter((column) => /approved_by|revoked_by|revoke_reason|signatory_github|user_id/.test(column)),
  ).toEqual([]);
});
