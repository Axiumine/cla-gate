// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { carryOverResultSchema } from '../../../shared/corporate-approvals.ts';
import {
  addAs,
  addedOf,
  approvalWorld,
  auditRowsOf,
  carryOverAs,
  storedApprovals,
} from './corporate-approval-fixture/test-support.ts';
import { expireDerivedApproval } from './corporate-claim-fixture/test-support.ts';
import { publishMajor, signAs } from './corporate-fixture/test-support.ts';

// An approval derived by a rule that has expired (E21-S04) covers nobody, but while it is not revoked it still holds the one place a person
// has under an agreement (`corporate_approvals_active_unique`). The manager who approves that person again, or carries the roster over to
// a new major that holds the expired row, must not meet a unique violation: the expired row is revoked as `expired` in the same
// transaction, by the manager, and audited, as the claim of the person does it.

const JANE_ID = 7001;

test('the signatory approves a person whose derived approval has expired: 201, the expired row is revoked as expired by the signatory and audited, and the new approval is the manager’s', async () => {
  const world = await approvalWorld();
  const domain = addedOf(
    await addAs(world, world.ada, world.adas.id, { kind: 'email_domain', domain: 'acme.example' }),
  );
  const expired = await expireDerivedApproval(world, { githubId: JANE_ID, parentId: domain.id });
  const added = addedOf(await addAs(world, world.ada, world.adas.id, { kind: 'user', login: 'jane-doe' }));
  const rows = (await storedApprovals(world.db, world.adas.id)).filter((row) => row.subject_github_id === JANE_ID);
  expect(rows.map((row) => [row.id, row.source, row.revoked_at !== null, row.revoke_reason])).toEqual([
    [expired, 'rule', true, 'expired'],
    [added.id, 'manager', false, null],
  ]);
  const revoked = await auditRowsOf(world.db, 'corporate_approval.revoked');
  expect(revoked.map((row) => [row.subject_id, row.actor_github_id, row.metadata])).toEqual([
    [expired, 1234, { kind: 'user', github_id: JANE_ID, signature_id: world.adas.signatureId, reason_code: 'expired' }],
  ]);
});

test('an approval that is in force is not retired: the same person twice is still a 409, and nothing is revoked', async () => {
  const world = await approvalWorld();
  addedOf(await addAs(world, world.ada, world.adas.id, { kind: 'user', login: 'jane-doe' }));
  const again = await addAs(world, world.ada, world.adas.id, { kind: 'user', login: 'jane-doe' });
  expect(again.statusCode).toBe(409);
  expect(await auditRowsOf(world.db, 'corporate_approval.revoked')).toEqual([]);
});

test('the carry-over to a major that holds an expired approval of a person in the roster copies the person, revoking the expired row as expired', async () => {
  const world = await approvalWorld();
  const first = world.adas;
  addedOf(await addAs(world, world.ada, first.id, { kind: 'user', login: 'jane-doe' }));
  const second = await signAs(world, world.ada, world.c1, await publishMajor(world, world.c1, 2));
  const domain = addedOf(await addAs(world, world.ada, second.id, { kind: 'email_domain', domain: 'acme.example' }));
  const expired = await expireDerivedApproval({ ...world, adas: second }, { githubId: JANE_ID, parentId: domain.id });
  const response = await carryOverAs(world, world.ada, second.id, { fromAgreementId: first.id });
  expect(response.statusCode).toBe(200);
  expect(carryOverResultSchema.parse(response.json())).toEqual({ copied: 1, skipped: 1 });
  const rows = (await storedApprovals(world.db, second.id)).filter((row) => row.subject_github_id === JANE_ID);
  expect(rows.map((row) => [row.id === expired, row.source, row.revoked_at !== null, row.revoke_reason])).toEqual([
    [true, 'rule', true, 'expired'],
    [false, 'manager', false, null],
  ]);
  const reasons = (await auditRowsOf(world.db, 'corporate_approval.revoked')).map((row) => [
    row.subject_id,
    row.metadata,
  ]);
  expect(reasons).toEqual([
    [expired, { kind: 'user', github_id: JANE_ID, signature_id: second.signatureId, reason_code: 'expired' }],
  ]);
});
