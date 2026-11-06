// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { containing, migratedRuntimeDatabase } from '../../adapters/db/test-support.ts';
import { openCorporateExport } from './corporate-export.ts';
import {
  approveAt,
  corporationOf,
  EXPORTER,
  hoursAfterEpoch,
  runCorporateExport,
  signFor,
} from './corporate-export-fixture/test-support.ts';
import { recordCorporateExport } from './corporate-export-record.ts';

// The audit row a corporate export leaves (E21): committed before the first byte of the file, with the number of rows the file holds and
// nothing from it, and written by the runtime role of the application. The routes are in adapters/http/corporate-export-audit.test.ts.

/** Two tenants: the first with two agreements and three approvals, the second with one of each. */
async function twoTenants() {
  const { db } = await migratedRuntimeDatabase();
  const one = await corporationOf(db, 1);
  const two = await corporationOf(db, 2);
  const first = await signFor(db, one, { githubId: 6001, companyName: 'First Company' });
  await signFor(db, one, { githubId: 6003, companyName: 'Third Company' });
  const second = await signFor(db, two, { githubId: 6002, companyName: 'Second Company' });
  await approveAt(db, first, { kind: 'user', githubId: 7001 }, hoursAfterEpoch(0));
  await approveAt(db, first, { kind: 'github_org', githubId: 9100 }, hoursAfterEpoch(1));
  await approveAt(db, first, { kind: 'email_domain', domain: 'first.example' }, hoursAfterEpoch(2));
  await approveAt(db, second, { kind: 'user', githubId: 7002 }, hoursAfterEpoch(0));
  return {
    db,
    scopeOne: { installationId: one.tenant.installationId },
    scopeTwo: { installationId: two.tenant.installationId },
  };
}

const auditRows = (db: Awaited<ReturnType<typeof twoTenants>>['db']) =>
  db
    .selectFrom('audit_log')
    .select(['action', 'installation_id', 'actor_github_id', 'subject_type', 'subject_id', 'metadata'])
    .where('action', 'in', ['corporate_agreements.exported', 'corporate_approvals.exported'])
    .orderBy('id')
    .execute();

test('the record counts the rows of the tenant for the kind asked, whatever their state, and names the tenant and the person', async () => {
  const { db, scopeOne, scopeTwo } = await twoTenants();
  expect(await recordCorporateExport(db, scopeOne, 'agreements', EXPORTER)).toBe(2);
  expect(await recordCorporateExport(db, scopeOne, 'approvals', EXPORTER)).toBe(3);
  expect(await recordCorporateExport(db, scopeTwo, 'agreements', EXPORTER)).toBe(1);
  expect(await recordCorporateExport(db, scopeTwo, 'approvals', EXPORTER)).toBe(1);
  expect(await auditRows(db)).toEqual([
    {
      action: 'corporate_agreements.exported',
      installation_id: scopeOne.installationId,
      actor_github_id: EXPORTER,
      subject_type: null,
      subject_id: null,
      metadata: { row_count: 2 },
    },
    expect.objectContaining({ action: 'corporate_approvals.exported', metadata: { row_count: 3 } }),
    expect.objectContaining({
      action: 'corporate_agreements.exported',
      installation_id: scopeTwo.installationId,
      metadata: { row_count: 1 },
    }),
    expect.objectContaining({ action: 'corporate_approvals.exported', metadata: { row_count: 1 } }),
  ]);
});

test('a revoked approval is in the count, as it is a row of the file', async () => {
  const { db, scopeOne } = await twoTenants();
  await sql`update corporate_approvals set revoked_at = now(), revoked_by = approved_by, revoke_reason = 'left'
    where installation_id = ${scopeOne.installationId} and kind = 'user'`.execute(db);
  expect(await recordCorporateExport(db, scopeOne, 'approvals', EXPORTER)).toBe(3);
});

test('a tenant with nothing to export is recorded with a count of zero', async () => {
  const { db } = await migratedRuntimeDatabase();
  const empty = await corporationOf(db, 1);
  const scope = { installationId: empty.tenant.installationId };
  expect(await recordCorporateExport(db, scope, 'agreements', EXPORTER)).toBe(0);
  expect((await auditRows(db)).map((row) => row.metadata)).toEqual([{ row_count: 0 }]);
});

test('the row is committed before a byte of the file is read: a stream destroyed before anything was read leaves it', async () => {
  const { db, scopeOne } = await twoTenants();
  const stream = await openCorporateExport(db, scopeOne, 'approvals', {
    actor: EXPORTER,
    onReleaseError: () => undefined,
  });
  stream.destroy();
  expect((await auditRows(db)).map((row) => row.metadata)).toEqual([{ row_count: 3 }]);
});

test('a file read to the end leaves exactly one row, with the number of data rows in it', async () => {
  const { db, scopeOne } = await twoTenants();
  const run = await runCorporateExport(db, scopeOne, 'approvals');
  expect(run.text.trimEnd().split('\r\n')).toHaveLength(1 + 3);
  expect((await auditRows(db)).map((row) => row.metadata)).toEqual([{ row_count: 3 }]);
});

test('an audit row that cannot be written means no file and no row, and a second try succeeds once it can', async () => {
  const { db, scopeOne } = await twoTenants();
  await sql`
    create function refuse_corporate_export_audit() returns trigger language plpgsql as $$
    begin raise exception 'audit insert refused'; end $$`.execute(db);
  await sql`
    create trigger refuse_corporate_export_audit before insert on audit_log for each row
    when (new.action = 'corporate_approvals.exported') execute function refuse_corporate_export_audit()`.execute(db);
  await expect(
    openCorporateExport(db, scopeOne, 'approvals', { actor: EXPORTER, onReleaseError: () => undefined }),
  ).rejects.toMatchObject({ message: containing('audit insert refused') });
  expect(await auditRows(db)).toEqual([]);
  await sql`drop trigger refuse_corporate_export_audit on audit_log`.execute(db);
  expect((await runCorporateExport(db, scopeOne, 'approvals')).releaseErrors).toEqual([]);
  expect(await auditRows(db)).toHaveLength(1);
});
