// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { NoResultError } from 'kysely';
import { expect, test } from 'vitest';
import {
  corporateTenant,
  DOMAIN,
  daysFromNow,
  insertApprovalRow,
  PEOPLE,
} from '../adapters/db/corporate-fixture/test-support.ts';
import { installationRowIdSchema } from '../adapters/db/installation-row-id.ts';
import { twoTenants } from '../adapters/db/tenant-fixture/test-support.ts';
import { migratedTestDatabase } from '../adapters/db/test-support.ts';
import { countActiveApprovals, domainApprovals } from './corporate-approval-coverage-queries.ts';
import { activeApprovalRows, approvalPageRows, findApprovalRow, getApprovalRow } from './corporate-approval-queries.ts';

// The reads behind the approvals of a corporate agreement (E21-S03). Every statement carries the installation id (the registry of the
// tenant data access holds each one to it); these tests are what the rows are: the states, the order, the page, and the read the
// claim of E21-S04 will make by domain, which covers a tenant's own approvals only.

const SIGNATORY = 8001;

/** Both tenants with an agreement of their own signer and an approval of each kind (the same domain in both), and the first's ids. */
async function world() {
  const { db } = await migratedTestDatabase();
  const tenants = await twoTenants(db);
  const first = await corporateTenant(db, tenants.t1, SIGNATORY);
  const second = await corporateTenant(db, tenants.t2, SIGNATORY + 1);
  return {
    db,
    ...tenants,
    first,
    second,
    scope: { installationId: tenants.t1.installationId },
    otherScope: { installationId: tenants.t2.installationId },
  };
}

test('the approvals of an agreement are read with their login snapshot, newest first, with the next one past the limit', async () => {
  const { db, scope, first } = await world();
  const agreementId = first.signed.agreementId;
  const rows = await approvalPageRows(db, scope, { agreementId, limit: 3, from: null });
  expect(rows.map((row) => row.id)).toEqual([
    first.derivedApproval,
    first.employeeApproval,
    first.orgApproval,
    first.domainApproval,
  ]);
  expect(rows[0]?.subject).toEqual({ kind: 'user', githubId: PEOPLE.derivedEmployee, login: 'derived-login' });
  expect(rows[2]?.subject).toEqual({ kind: 'github_org', githubId: PEOPLE.org, login: 'acme-org' });
  expect(rows[3]?.subject).toEqual({ kind: 'email_domain', domain: DOMAIN });
  expect(rows.map((row) => [row.source, row.derivedFromApprovalId, row.expired])).toEqual([
    ['rule', first.domainApproval, false],
    ['manager', null, false],
    ['manager', null, false],
    ['manager', null, false],
  ]);
});

test('a page starts at the approval of the position, that one included, and an agreement of another tenant has no rows for the scope', async () => {
  const { db, scope, otherScope, first, second } = await world();
  const from = await approvalPageRows(db, scope, {
    agreementId: first.signed.agreementId,
    limit: 10,
    from: { id: first.orgApproval },
  });
  expect(from.map((row) => row.id)).toEqual([first.orgApproval, first.domainApproval, first.ownApproval]);
  const crossed = { agreementId: second.signed.agreementId, limit: 10, from: null };
  expect(await approvalPageRows(db, scope, crossed)).toEqual([]);
  expect(await approvalPageRows(db, otherScope, crossed)).toHaveLength(5);
});

test('an approval is found in its agreement and tenant only: another agreement, another tenant and a missing id find nothing', async () => {
  const { db, scope, first, second } = await world();
  const at = { agreementId: first.signed.agreementId, approvalId: first.orgApproval };
  expect((await findApprovalRow(db, scope, at))?.id).toBe(first.orgApproval);
  expect(await findApprovalRow(db, scope, { ...at, approvalId: second.orgApproval })).toBeNull();
  expect(
    await findApprovalRow(db, scope, { agreementId: second.signed.agreementId, approvalId: second.orgApproval }),
  ).toBeNull();
  expect(await findApprovalRow(db, scope, { ...at, approvalId: 987_654 })).toBeNull();
});

test('an approval that must be there is read, and one that is not is a NoResultError: a defect, not an answer', async () => {
  const { db, scope, first, second } = await world();
  const at = { agreementId: first.signed.agreementId, approvalId: first.orgApproval };
  expect((await getApprovalRow(db, scope, at)).id).toBe(first.orgApproval);
  await expect(getApprovalRow(db, scope, { ...at, approvalId: second.orgApproval })).rejects.toThrow(NoResultError);
});

test('an approval is expired when its end is behind the clock of the database, and is neither active nor counted', async () => {
  const { db, t1, scope, first } = await world();
  const agreementId = first.signed.agreementId;
  const expired = await insertApprovalRow(db, {
    installation_id: t1.installationId,
    agreement_id: agreementId,
    kind: 'user',
    subject_github_id: 7500,
    subject_domain: null,
    source: 'rule',
    derived_from_approval_id: first.domainApproval,
    approved_at: daysFromNow(-3),
    expires_at: daysFromNow(-1),
  });
  const at = { agreementId, approvalId: expired };
  expect((await getApprovalRow(db, scope, at)).expired).toBe(true);
  expect((await activeApprovalRows(db, scope, agreementId)).map((row) => row.id)).toEqual([
    first.ownApproval,
    first.domainApproval,
    first.orgApproval,
    first.employeeApproval,
    first.derivedApproval,
  ]);
  expect(await countActiveApprovals(db, scope, agreementId)).toBe(5);
});

test('a revoked approval is not active and is not counted, and the other tenant counts its own', async () => {
  const { db, scope, otherScope, first, second } = await world();
  await db
    .updateTable('corporate_approvals')
    .set({ revoked_at: daysFromNow(1), revoked_by: first.signed.person.userId })
    .where('id', '=', first.orgApproval)
    .execute();
  expect(await countActiveApprovals(db, scope, first.signed.agreementId)).toBe(4);
  expect((await activeApprovalRows(db, scope, first.signed.agreementId)).map((row) => row.id)).not.toContain(
    first.orgApproval,
  );
  expect(await countActiveApprovals(db, otherScope, second.signed.agreementId)).toBe(5);
  expect(await countActiveApprovals(db, scope, second.signed.agreementId)).toBe(0);
});

test('a domain approval of one tenant covers nobody in another: the same domain is two approvals, each found under its own tenant', async () => {
  const { db, scope, otherScope, first, second } = await world();
  expect(await domainApprovals(db, scope, DOMAIN)).toEqual([
    { approvalId: first.domainApproval, agreementId: first.signed.agreementId },
  ]);
  expect(await domainApprovals(db, otherScope, DOMAIN)).toEqual([
    { approvalId: second.domainApproval, agreementId: second.signed.agreementId },
  ]);
  expect(await domainApprovals(db, { installationId: installationRowIdSchema.parse(987_654) }, DOMAIN)).toEqual([]);
});

test.each([
  ['a subdomain of the approved domain', `mail.${DOMAIN}`],
  ['a name that starts with the approved domain', `${DOMAIN}.evil.test`],
  ['a name that ends with the approved domain', `not${DOMAIN}`],
  ['the parent of the approved domain', DOMAIN.split('.').slice(1).join('.')],
  ['the approved domain in capitals, which is not the stored form', DOMAIN.toUpperCase()],
])('%s is covered by no approval: the match is an equality', async (_label, domain) => {
  const { db, scope, otherScope } = await world();
  expect(await domainApprovals(db, scope, domain)).toEqual([]);
  expect(await domainApprovals(db, otherScope, domain)).toEqual([]);
});

test('a domain of a revoked approval, and a domain of a revoked agreement, cover nobody', async () => {
  const { db, scope, otherScope, first, second } = await world();
  await db
    .updateTable('corporate_approvals')
    .set({ revoked_at: daysFromNow(1), revoked_by: first.signed.person.userId })
    .where('id', '=', first.domainApproval)
    .execute();
  expect(await domainApprovals(db, scope, DOMAIN)).toEqual([]);
  await db
    .updateTable('signatures')
    .set({ revoked_at: daysFromNow(1), revoked_by: second.signed.person.userId, revoke_reason: 'maintainer_decision' })
    .where('id', '=', second.signed.signatureId)
    .execute();
  expect(await domainApprovals(db, otherScope, DOMAIN)).toEqual([]);
});
