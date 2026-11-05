// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { NoResultError, sql } from 'kysely';
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { corporateTenant, personWithId, signCorporate } from '../adapters/db/corporate-fixture/test-support.ts';
import { twoTenants } from '../adapters/db/tenant-fixture/test-support.ts';
import { migratedTestDatabase } from '../adapters/db/test-support.ts';
import {
  insertAgreement,
  insertAgreementText,
  insertSignatoryApproval,
  ownAgreementRows,
  tenantAgreementRows,
} from './corporate-agreement-queries.ts';

// The statements behind corporate signing over the agreements (E21-S02). `ownAgreementRows` lists the agreements of a person in every
// tenant on purpose (the registry of the tenant data access names this file as the test that pins it); the others carry the
// installation id in their WHERE clause.

const SIGNATORY = 8001;

async function world() {
  const { db } = await migratedTestDatabase();
  const tenants = await twoTenants(db);
  const first = await corporateTenant(db, tenants.t1, SIGNATORY, { companyName: 'First Co', signatoryTitle: 'CEO' });
  const second = await corporateTenant(db, tenants.t2, SIGNATORY, { companyName: 'Second Co', signatoryTitle: 'CTO' });
  const person = await personWithId(db, SIGNATORY);
  return {
    db,
    ...tenants,
    first,
    second,
    person,
    firstId: first.signed.agreementId,
    secondId: second.signed.agreementId,
  };
}

test('ownAgreementRows lists the agreements of one person in every tenant, newest first, with the state of the installation', async () => {
  const { db, person, firstId, secondId } = await world();
  const rows = await ownAgreementRows(db, person.userId, { limit: 10, from: null, agreementId: null });
  expect(rows.map((row) => [row.id, row.companyName, row.accountLogin, row.activeApprovals])).toEqual([
    [secondId, 'Second Co', 'org-2', 5],
    [firstId, 'First Co', 'org-1', 5],
  ]);
  expect(rows[0]).toMatchObject({
    revokedAt: null,
    suspendedAt: null,
    deletedAt: null,
    admissionStatus: 'admitted',
    signatoryGithubId: SIGNATORY,
  });
});

test('ownAgreementRows lists the agreements of nobody else, and one more row than the limit when a page follows', async () => {
  const { db, person, t1, firstId, secondId } = await world();
  expect(await ownAgreementRows(db, t1.publisherId, { limit: 10, from: null, agreementId: null })).toEqual([]);
  const page = await ownAgreementRows(db, person.userId, { limit: 1, from: null, agreementId: null });
  expect(page.map((row) => row.id)).toEqual([secondId, firstId]);
});

test('ownAgreementRows starts at the agreement of the position, that one included, and finds one agreement by its id', async () => {
  const { db, person, firstId, secondId } = await world();
  const from = await ownAgreementRows(db, person.userId, { limit: 10, from: { id: firstId }, agreementId: null });
  expect(from.map((row) => row.id)).toEqual([firstId]);
  const one = await ownAgreementRows(db, person.userId, { limit: 1, from: null, agreementId: secondId });
  expect(one.map((row) => row.id)).toEqual([secondId]);
  expect(await ownAgreementRows(db, person.userId, { limit: 1, from: null, agreementId: 987_654 })).toEqual([]);
});

test('tenantAgreementRows lists the agreements of the tenant only', async () => {
  const { db, t1, t2, firstId, secondId } = await world();
  const own = await tenantAgreementRows(db, { installationId: t1.installationId }, { limit: 10, from: null });
  expect(own.map((row) => row.id)).toEqual([firstId]);
  const other = await tenantAgreementRows(
    db,
    { installationId: t2.installationId },
    { limit: 1, from: { id: secondId } },
  );
  expect(other.map((row) => row.id)).toEqual([secondId]);
  expect(
    await tenantAgreementRows(db, { installationId: t1.installationId }, { limit: 10, from: { id: firstId - 1 } }),
  ).toEqual([]);
});

test('the text of the company, the title and the login are null once the signatory was erased, and the approvals still count', async () => {
  const { db, t1, people } = await world();
  await sql`select erase_signer_pii(${SIGNATORY}, ${people.admin1.githubId}, ${t1.installationId})`.execute(db);
  const [row] = await tenantAgreementRows(db, { installationId: t1.installationId }, { limit: 1, from: null });
  expect(row).toMatchObject({ companyName: null, signatoryTitle: null, signatoryLogin: null, activeApprovals: 5 });
});

test('the three inserts of a signing write their row for a signature of the tenant and refuse one of another tenant', async () => {
  const { db, t1, t2, first } = await world();
  const eve = await personWithId(db, 8002);
  const signatureId = await signCorporate(db, t1, first.document, eve);
  const scope = { installationId: t1.installationId };
  const elsewhere = { installationId: t2.installationId };
  await expect(insertAgreement(db, elsewhere, signatureId)).rejects.toBeInstanceOf(NoResultError);
  const agreementId = await insertAgreement(db, scope, signatureId);
  const text = { agreementId, companyName: 'Eve Co', signatoryTitle: 'Owner' };
  await expect(insertAgreementText(db, elsewhere, text)).rejects.toBeInstanceOf(NoResultError);
  await insertAgreementText(db, scope, text);
  const approval = { agreementId, userId: eve.userId, githubId: parseGithubId(eve.githubId), login: 'eve-login' };
  await expect(insertSignatoryApproval(db, elsewhere, approval)).rejects.toBeInstanceOf(NoResultError);
  expect(await insertSignatoryApproval(db, scope, approval)).toBeGreaterThan(0);
  const stored = await db
    .selectFrom('corporate_approvals')
    .select(['kind', 'source', 'subject_github_id', 'approved_by'])
    .where('agreement_id', '=', agreementId)
    .execute();
  expect(stored).toEqual([{ kind: 'user', source: 'manager', subject_github_id: 8002, approved_by: eve.userId }]);
});
