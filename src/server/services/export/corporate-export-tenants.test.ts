// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { asRuntimeRole, migratedRuntimeDatabase } from '../../adapters/db/test-support.ts';
import { csvRecords } from '../../domain/csv-fixture/test-support.ts';
import {
  approveAt,
  corporationOf,
  hoursAfterEpoch,
  runCorporateExport,
  signFor,
} from './corporate-export-fixture/test-support.ts';
import { agreementExportBatch, approvalExportBatch } from './corporate-export-queries.ts';

// Whose rows the corporate exports hold (E21-S05): the tenant's own and no other's, no personal data once the person was erased, and nothing the
// application's own database role may not read. The names below are told apart on purpose: a row of the other tenant would show in a cell.

const SIGNATORY = 6001;
const ACTOR = 9999;

/** Two tenants with an agreement each, signed by different people for different companies, each approving a user and a domain of its own. */
async function twoTenants() {
  const { db } = await migratedRuntimeDatabase();
  const one = await corporationOf(db, 1);
  const two = await corporationOf(db, 2);
  const first = await signFor(db, one, { githubId: SIGNATORY, companyName: 'First Company', login: 'first-signatory' });
  const second = await signFor(db, two, { githubId: 6002, companyName: 'Second Company', login: 'second-signatory' });
  await approveAt(db, first, { kind: 'user', githubId: 7001 }, hoursAfterEpoch(0));
  await approveAt(db, first, { kind: 'email_domain', domain: 'first.example' }, hoursAfterEpoch(1));
  await approveAt(db, second, { kind: 'user', githubId: 7002 }, hoursAfterEpoch(0));
  await approveAt(db, second, { kind: 'email_domain', domain: 'second.example' }, hoursAfterEpoch(1));
  return {
    db,
    first,
    second,
    scopes: [{ installationId: one.tenant.installationId }, { installationId: two.tenant.installationId }] as const,
  };
}

test('the agreements and the approvals of a tenant are its own: the other tenant has none of its companies, people or domains in the file', async () => {
  const { db, first, second, scopes } = await twoTenants();
  const [scopeOne, scopeTwo] = scopes;
  const ownAgreements = csvRecords((await runCorporateExport(db, scopeOne, 'agreements')).text);
  expect(ownAgreements.map((row) => [row['agreement_id'], row['company_name'], row['signatory_login']])).toEqual([
    [String(first.agreementId), 'First Company', 'first-signatory'],
  ]);
  const otherAgreements = csvRecords((await runCorporateExport(db, scopeTwo, 'agreements')).text);
  expect(otherAgreements.map((row) => [row['agreement_id'], row['company_name']])).toEqual([
    [String(second.agreementId), 'Second Company'],
  ]);
  const ownApprovals = csvRecords((await runCorporateExport(db, scopeOne, 'approvals')).text);
  expect(ownApprovals.map((row) => [row['agreement_id'], row['subject']])).toEqual([
    [String(first.agreementId), '7001'],
    [String(first.agreementId), 'first.example'],
  ]);
  const otherApprovals = csvRecords((await runCorporateExport(db, scopeTwo, 'approvals')).text);
  expect(otherApprovals.map((row) => [row['agreement_id'], row['subject']])).toEqual([
    [String(second.agreementId), '7002'],
    [String(second.agreementId), 'second.example'],
  ]);
});

test('after the erasure of the signatory the agreement is still a row, with no company and no login, and the numeric id of the signatory', async () => {
  const { db, first, scopes } = await twoTenants();
  const [scopeOne] = scopes;
  await sql`select erase_signer_pii(${SIGNATORY}, ${ACTOR}, ${scopeOne.installationId})`.execute(db);
  const [row] = csvRecords((await runCorporateExport(db, scopeOne, 'agreements')).text);
  expect(row).toMatchObject({
    agreement_id: String(first.agreementId),
    company_name: '',
    signatory_github_id: String(SIGNATORY),
    signatory_login: '',
    revoked: 'false',
  });
});

test('the erasure of an employee changes no cell of the approvals file: it holds numeric ids and domains only', async () => {
  const { db, scopes } = await twoTenants();
  const [scopeOne] = scopes;
  const before = (await runCorporateExport(db, scopeOne, 'approvals')).text;
  await sql`select erase_signer_pii(7001, ${ACTOR}, ${scopeOne.installationId})`.execute(db);
  expect((await runCorporateExport(db, scopeOne, 'approvals')).text).toBe(before);
});

test('the application role reads what both exports need, and only its tenant: the statements run as cla_app', async () => {
  const { db, first, scopes } = await twoTenants();
  const [scopeOne] = scopes;
  const page = { afterId: 0, limit: 50 };
  const agreements = await asRuntimeRole(db, (trx) => agreementExportBatch(trx, scopeOne, page));
  expect(agreements.map((row) => [row.agreementId, row.companyName, row.signatoryLogin])).toEqual([
    [first.agreementId, 'First Company', 'first-signatory'],
  ]);
  const approvals = await asRuntimeRole(db, (trx) => approvalExportBatch(trx, scopeOne, page));
  expect(approvals.map((row) => row.agreementId)).toEqual([first.agreementId, first.agreementId]);
});
