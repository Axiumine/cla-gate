// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { approve, corporateTenant, PEOPLE } from '../adapters/db/corporate-fixture/test-support.ts';
import { twoTenants } from '../adapters/db/tenant-fixture/test-support.ts';
import { migratedTestDatabase } from '../adapters/db/test-support.ts';
import { eraseSigner, erasureCounts } from './signer-erasure.ts';
import { SignerNotFoundError } from './signer-erasure-errors.ts';
import { ACTOR } from './test-support.ts';

// The erasure of a person a corporate agreement approves (E21-S03): the login snapshot kept with the approval is personal data, so a person
// who never signed and is on no allowlist, known to the tenant only as the subject of an approval, is counted, found and erased.

const EMPLOYEE = parseGithubId(PEOPLE.employee);

/** Both tenants with a corporate agreement and the approvals of every kind; the employee is approved in both, and signed in neither. */
async function world() {
  const { db } = await migratedTestDatabase();
  const tenants = await twoTenants(db);
  const first = await corporateTenant(db, tenants.t1, tenants.t1.signer.githubId);
  const second = await corporateTenant(db, tenants.t2, tenants.t2.signer.githubId);
  return { db, ...tenants, first, second };
}

/** The login snapshots kept with the approvals of the employee, by installation. */
async function snapshots(db: Awaited<ReturnType<typeof world>>['db']) {
  return (
    await sql<{ installation_id: number; login: string }>`
      select a.installation_id, p.login from corporate_approval_pii as p
      join corporate_approvals as a on a.id = p.approval_id
      where a.kind = 'user' and a.subject_github_id = ${PEOPLE.employee}
      order by a.installation_id`.execute(db)
  ).rows;
}

test('the counts hold the approvals of kind user that name the person in this tenant, and no other tenant, and not an organisation', async () => {
  const { db, t1, t2 } = await world();
  const empty = { signatures: 0, signerPiiRows: 0, allowlistEntries: 0 };
  expect(await erasureCounts(db, t1, EMPLOYEE)).toEqual({ ...empty, corporateApprovals: 1 });
  expect(await erasureCounts(db, t2, EMPLOYEE)).toEqual({ ...empty, corporateApprovals: 1 });
  expect(await erasureCounts(db, t1, parseGithubId(PEOPLE.org))).toEqual({ ...empty, corporateApprovals: 0 });
  expect(await erasureCounts(db, t1, parseGithubId(987_654))).toEqual({ ...empty, corporateApprovals: 0 });
});

test('a revoked approval still counts: the snapshot stays with it', async () => {
  const { db, t1, first } = await world();
  await sql`update corporate_approvals set revoked_at = now() + interval '1 minute', revoked_by = ${t1.signer.userId}
    where id = ${first.employeeApproval}`.execute(db);
  expect((await erasureCounts(db, t1, EMPLOYEE)).corporateApprovals).toBe(1);
});

test('a person known to the tenant only by an approval is erased: the login snapshot goes in this tenant only, the approval stays, the audit row is the tenant’s', async () => {
  const { db, t1, t2 } = await world();
  const approvalsBefore = (await sql`select * from corporate_approvals order by id`.execute(db)).rows;
  expect(await snapshots(db)).toEqual([
    { installation_id: t1.installationId, login: 'employee-login' },
    { installation_id: t2.installationId, login: 'employee-login' },
  ]);
  expect(await eraseSigner(db, t1, { githubUserId: EMPLOYEE, expectedRows: 0, actor: ACTOR })).toBe(0);
  expect(await snapshots(db)).toEqual([{ installation_id: t2.installationId, login: 'employee-login' }]);
  expect((await sql`select * from corporate_approvals order by id`.execute(db)).rows).toEqual(approvalsBefore);
  expect((await erasureCounts(db, t1, EMPLOYEE)).corporateApprovals).toBe(1);
  const audit = await db.selectFrom('audit_log').selectAll().where('action', '=', 'signer_pii.erased').execute();
  expect(audit.map((row) => [row.installation_id, row.subject_id, row.metadata])).toEqual([
    [t1.installationId, EMPLOYEE, { signer_pii_rows: 0 }],
  ]);
});

test('a person only another tenant approves is not found in this one, and nothing is changed', async () => {
  const { db, t1, second } = await world();
  const outsider = 7003;
  await approve(db, second.signed, { kind: 'user', githubId: outsider, login: 'zzzz-outsider' });
  await expect(
    eraseSigner(db, t1, { githubUserId: parseGithubId(outsider), expectedRows: 0, actor: ACTOR }),
  ).rejects.toBeInstanceOf(SignerNotFoundError);
  expect(
    (await sql`select login from corporate_approval_pii where login = 'zzzz-outsider'`.execute(db)).rows,
  ).toHaveLength(1);
});
