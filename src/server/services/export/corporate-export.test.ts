// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { CORPORATE_AGREEMENT_CSV_COLUMNS, CORPORATE_APPROVAL_CSV_COLUMNS } from '../../../shared/corporate-export.ts';
import { HOSTILE_NAMES } from '../../../shared/hostile-names.ts';
import { migratedTestDatabase } from '../../adapters/db/test-support.ts';
import { neutraliseFormula } from '../../domain/csv.ts';
import { csvRecords, parseCsv } from '../../domain/csv-fixture/test-support.ts';
import {
  approveAt,
  corporationOf,
  hoursAfterEpoch,
  revokeApprovalAt,
  ruleApprovalAt,
  runCorporateExport,
  signFor,
  withoutInstants,
} from './corporate-export-fixture/test-support.ts';

// The two files the corporate exports write (E21-S05), read from the migrated database: the columns, the hostile dataset stored as a snapshot for
// each file, the cells of an erased and of a revoked agreement or approval, and what another tenant's rows never are.

const AGREEMENTS_HEADER = 'agreement_id,signed_at,major,company_name,signatory_github_id,signatory_login,revoked';
const APPROVALS_HEADER = 'approval_id,agreement_id,kind,subject,source,approved_at,expires_at,revoked_at';

/** The company the mandatory case of the story names: a formula that would call out to a server of the attacker. */
const FORMULA_COMPANY = '=HYPERLINK("http://x","y")';

async function world() {
  const { db } = await migratedTestDatabase();
  const corporation = await corporationOf(db, 1);
  const scope = { installationId: corporation.tenant.installationId };
  return { db, corporation, scope };
}

test('the header rows are the columns of the story in order, and a tenant with no agreement exports the header alone', async () => {
  const { db, scope } = await world();
  expect((await runCorporateExport(db, scope, 'agreements')).text).toBe(`${AGREEMENTS_HEADER}\r\n`);
  expect((await runCorporateExport(db, scope, 'approvals')).text).toBe(`${APPROVALS_HEADER}\r\n`);
  expect(CORPORATE_AGREEMENT_CSV_COLUMNS.join(',')).toBe(AGREEMENTS_HEADER);
  expect(CORPORATE_APPROVAL_CSV_COLUMNS.join(',')).toBe(APPROVALS_HEADER);
});

test('the agreements of the hostile dataset are the file stored as a snapshot: a formula company and an @ login leave guarded', async () => {
  const { db, corporation, scope } = await world();
  await signFor(db, corporation, { githubId: 6001, companyName: FORMULA_COMPANY, login: '@octocat' });
  await signFor(db, corporation, { githubId: 6002, companyName: 'Plain & Co, "Ltd"', login: 'plain-login' });
  const run = await runCorporateExport(db, scope, 'agreements');
  expect(run.releaseErrors).toEqual([]);
  await expect(withoutInstants(run.text)).toMatchFileSnapshot('csv-snapshots/corporate-agreements.csv');
  const [formula] = csvRecords(run.text);
  expect(formula).toMatchObject({
    company_name: `'${FORMULA_COMPANY}`,
    signatory_login: "'@octocat",
    signatory_github_id: '6001',
  });
});

test('every entry of HOSTILE_NAMES comes out as one company cell, guarded when it starts a formula, and no cell begins with a trigger', async () => {
  const { db, corporation, scope } = await world();
  for (const [index, name] of HOSTILE_NAMES.entries()) {
    await signFor(db, corporation, { githubId: 6100 + index, companyName: name, login: name });
  }
  const text = (await runCorporateExport(db, scope, 'agreements')).text;
  const records = csvRecords(text);
  expect(records.map((record) => record['company_name'])).toEqual(HOSTILE_NAMES.map(neutraliseFormula));
  expect(records.map((record) => record['signatory_login'])).toEqual(HOSTILE_NAMES.map(neutraliseFormula));
  expect(
    parseCsv(text)
      .slice(1)
      .flat()
      .filter((cell) => /^[=+\-@\t\r]/.test(cell)),
  ).toEqual([]);
});

test('the approvals are the file stored as a snapshot, with every kind, source and instant of the story', async () => {
  const { db, corporation, scope } = await world();
  const signed = await signFor(db, corporation, { githubId: 6001, companyName: FORMULA_COMPANY, login: '@octocat' });
  await approveAt(db, signed, { kind: 'user', githubId: 7001 }, hoursAfterEpoch(0));
  await approveAt(db, signed, { kind: 'github_org', githubId: 9100 }, hoursAfterEpoch(1));
  const domain = await approveAt(db, signed, { kind: 'email_domain', domain: 'acme.example' }, hoursAfterEpoch(2));
  await ruleApprovalAt(db, signed, {
    parentId: domain,
    githubId: 7002,
    at: hoursAfterEpoch(3),
    expiresAt: hoursAfterEpoch(3 + 24 * 365),
  });
  const left = await approveAt(db, signed, { kind: 'user', githubId: 7003 }, hoursAfterEpoch(4));
  await revokeApprovalAt(db, signed, left, hoursAfterEpoch(5));
  const run = await runCorporateExport(db, scope, 'approvals');
  expect(run.releaseErrors).toEqual([]);
  await expect(run.text).toMatchFileSnapshot('csv-snapshots/corporate-approvals.csv');
  expect(csvRecords(run.text).map((record) => [record['kind'], record['subject'], record['source']])).toEqual([
    ['user', '7001', 'manager'],
    ['github_org', '9100', 'manager'],
    ['email_domain', 'acme.example', 'manager'],
    ['user', '7002', 'rule'],
    ['user', '7003', 'manager'],
  ]);
});

test('the cells of an agreement: ids, the major, ISO instants with milliseconds, the signatory by id and login, and the revocation flag', async () => {
  const { db, corporation, scope } = await world();
  const signed = await signFor(db, corporation, { githubId: 6001, companyName: 'Acme Corp', login: 'signatory-login' });
  const stamped = await db
    .selectFrom('signatures')
    .select('signed_at')
    .where('id', '=', signed.signatureId)
    .executeTakeFirstOrThrow();
  const [active] = csvRecords((await runCorporateExport(db, scope, 'agreements')).text);
  expect(active).toEqual({
    agreement_id: String(signed.agreementId),
    signed_at: stamped.signed_at.toISOString(),
    major: '1',
    company_name: 'Acme Corp',
    signatory_github_id: '6001',
    signatory_login: 'signatory-login',
    revoked: 'false',
  });
  await sql`update signatures set revoked_at = now(), revoked_by = ${signed.person.userId}, revoke_reason = 'other' where id = ${signed.signatureId}`.execute(
    db,
  );
  const [revoked] = csvRecords((await runCorporateExport(db, scope, 'agreements')).text);
  expect(revoked).toMatchObject({
    agreement_id: String(signed.agreementId),
    revoked: 'true',
    company_name: 'Acme Corp',
  });
});
