// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { APPROVAL_LIMIT } from '../../../shared/corporate-approvals.ts';
import { addAs, revokeAs, seedUserApprovals } from './corporate-approval-fixture/test-support.ts';
import {
  ACME_DOMAIN,
  approveDomain,
  claimAs,
  claimAuditOf,
  claimOf,
  claimWorld,
  employee,
  expireDerivedApproval,
  userApprovalsOf,
} from './corporate-claim-fixture/test-support.ts';
import { failureOf } from './corporate-fixture/test-support.ts';

// What a claim writes (E21-S04): one approval derived from the domain or organisation approval, the audit row of the derivation in the same
// transaction and nothing personal in it, the renewal of an approval that expired, and the claims that race with the manager.

const EMMA = 7101;

test('a derivation writes one audit row of ids: the employee as actor, the new approval as subject, the kind, the signature, and no login, address or domain', async () => {
  const world = await claimWorld();
  await approveDomain(world, 'zzzz-corp.example');
  const emma = await employee(world, EMMA, [{ email: 'emma@zzzz-corp.example', primary: true }]);
  expect(claimOf(await claimAs(world, emma, world.t1.plain.githubRepoId))).toEqual([201, 'covered']);
  const [row] = await userApprovalsOf(world.db, EMMA);
  const audit = await claimAuditOf(world.db);
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({
    action: 'corporate_approval.derived',
    installation_id: world.t1.installationId,
    actor_github_id: EMMA,
    subject_type: 'corporate_approval',
    subject_id: row?.id,
    metadata: { kind: 'user', github_id: EMMA, signature_id: world.adas.signatureId, reason_code: null },
  });
  expect(JSON.stringify(audit)).not.toMatch(/zzzz|login-|emma/u);
});

test('an approval that expired covers nobody: the claim is no "already covered", the expired one is revoked as expired, and a new one is derived and audited', async () => {
  const world = await claimWorld();
  const domain = await approveDomain(world, ACME_DOMAIN);
  const emma = await employee(world, EMMA);
  const expired = await expireDerivedApproval(world, { githubId: EMMA, parentId: domain });
  expect(claimOf(await claimAs(world, emma, world.t1.plain.githubRepoId))).toEqual([201, 'covered']);
  const rows = await userApprovalsOf(world.db, EMMA);
  expect(rows.map((row) => [row.id === expired, row.revoked_at !== null, row.revoke_reason, row.revoked_by])).toEqual([
    [true, true, 'expired', emma.userId],
    [false, false, null, null],
  ]);
  expect(rows[1]).toMatchObject({ source: 'rule', derived_from_approval_id: domain, lifetimeDays: 365 });
  const audit = await claimAuditOf(world.db);
  expect(audit.map((row) => [row.action, row.subject_id, row.metadata])).toEqual([
    [
      'corporate_approval.revoked',
      expired,
      { kind: 'user', github_id: EMMA, signature_id: world.adas.signatureId, reason_code: 'expired' },
    ],
    [
      'corporate_approval.derived',
      rows[1]?.id,
      { kind: 'user', github_id: EMMA, signature_id: world.adas.signatureId, reason_code: null },
    ],
  ]);
});

test('an approval that expired whose domain approval was revoked since covers nobody either: 409, and nothing changes', async () => {
  const world = await claimWorld();
  const domain = await approveDomain(world, ACME_DOMAIN);
  const emma = await employee(world, EMMA);
  await expireDerivedApproval(world, { githubId: EMMA, parentId: domain });
  expect((await revokeAs(world, world.ada, { agreementId: world.adas.id, approvalId: domain })).statusCode).toBe(200);
  const before = await userApprovalsOf(world.db, EMMA);
  expect(failureOf(await claimAs(world, emma, world.t1.plain.githubRepoId))).toEqual([409, 'no_matching_approval']);
  expect(await userApprovalsOf(world.db, EMMA)).toEqual(before);
});

test('an approval in force is renewed by nobody: a second claim answers already covered and writes nothing', async () => {
  const world = await claimWorld();
  await approveDomain(world, ACME_DOMAIN);
  const emma = await employee(world, EMMA);
  expect(claimOf(await claimAs(world, emma, world.t1.plain.githubRepoId))).toEqual([201, 'covered']);
  const before = await userApprovalsOf(world.db, EMMA);
  expect(claimOf(await claimAs(world, emma, world.t1.plain.githubRepoId))).toEqual([200, 'already_covered']);
  expect(await userApprovalsOf(world.db, EMMA)).toEqual(before);
  expect(await claimAuditOf(world.db)).toHaveLength(1);
});

test('two claims of one person at once are made one after the other: one derives, the other finds it, one approval exists', async () => {
  const world = await claimWorld();
  await approveDomain(world, ACME_DOMAIN);
  const emma = await employee(world, EMMA);
  const answers = await Promise.all([
    claimAs(world, emma, world.t1.plain.githubRepoId),
    claimAs(world, emma, world.t1.plain.githubRepoId),
  ]);
  expect(answers.map((answer) => answer.statusCode).toSorted((a, b) => a - b)).toEqual([200, 201]);
  expect(await userApprovalsOf(world.db, EMMA)).toHaveLength(1);
  expect(await claimAuditOf(world.db)).toHaveLength(1);
});

test('a domain approval is shared by many people: each employee gets an approval of their own from it', async () => {
  const world = await claimWorld();
  const domain = await approveDomain(world, ACME_DOMAIN);
  for (const githubId of [7101, 7102, 7103]) {
    const person = await employee(world, githubId);
    expect(claimOf(await claimAs(world, person, world.t1.plain.githubRepoId))).toEqual([201, 'covered']);
  }
  const derived = await world.db
    .selectFrom('corporate_approvals')
    .select(['subject_github_id', 'derived_from_approval_id'])
    .where('source', '=', 'rule')
    .orderBy('id')
    .execute();
  expect(derived).toEqual(
    [7101, 7102, 7103].map((id) => ({ subject_github_id: id, derived_from_approval_id: domain })),
  );
});

test('the claim does not look at the number of approvals of the agreement: derived approvals are not held to the limit the manager is held to', async () => {
  const world = await claimWorld();
  await approveDomain(world, ACME_DOMAIN);
  const emma = await employee(world, EMMA);
  const agreement = { installationId: world.t1.installationId, agreementId: world.adas.id, userId: world.ada.userId };
  await seedUserApprovals(world.db, agreement, APPROVAL_LIMIT);
  const manager = await addAs(world, world.ada, world.adas.id, { kind: 'email_domain', domain: 'globex.example' });
  expect(failureOf(manager)).toEqual([422, 'approval_limit']);
  expect(claimOf(await claimAs(world, emma, world.t1.plain.githubRepoId))).toEqual([201, 'covered']);
});
