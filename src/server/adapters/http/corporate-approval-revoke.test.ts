// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { REVOKE_REASON_MAX_CODE_POINTS } from '../../../shared/corporate-approvals.ts';
import { approve, derive } from '../db/corporate-fixture/test-support.ts';
import {
  addAs,
  addedOf,
  approvalUrl,
  approvalWorld,
  auditRowsOf,
  changeAs,
  revokeAs,
  revokedOf,
  revokeSignature,
  stateOf,
  storedApprovals,
  suspendTenantOne,
} from './corporate-approval-fixture/test-support.ts';
import { detailsOf, failureOf, signedOf, UTC_INSTANT, withoutRequestId } from './corporate-fixture/test-support.ts';

// Revoking an approval (E21-S03): prospective only (the row stays, marked), with a reason of at most 500 characters that holds no
// address, one audit row, and for a domain or an organisation the approvals derived from it go with it, one audit row each.

/** The world with Jane approved by the manager, and the ids a revocation names. */
async function withJane() {
  const world = await approvalWorld();
  const jane = addedOf(await addAs(world, world.ada, world.adas.id, { kind: 'user', login: 'jane-doe' }));
  return { world, jane, ids: { agreementId: world.adas.id, approvalId: jane.id } };
}

test('a revocation with no body marks the approval revoked, stores who and when, keeps the row, and writes one audit row', async () => {
  const { world, jane, ids } = await withJane();
  const revoked = revokedOf(await revokeAs(world, world.ada, ids));
  expect(revoked.derivedRevoked).toBe(0);
  expect(revoked.approval).toEqual({ ...jane, state: 'revoked', revokedAt: UTC_INSTANT });
  const stored = (await storedApprovals(world.db, world.adas.id)).find((row) => row.id === jane.id);
  expect([stored?.subject_github_id, stored?.revoked_at === null, stored?.revoke_reason]).toEqual([7001, false, null]);
  const by = await world.db
    .selectFrom('corporate_approvals')
    .select('revoked_by')
    .where('id', '=', jane.id)
    .executeTakeFirst();
  expect(by?.revoked_by).toBe(world.ada.userId);
  const audit = await auditRowsOf(world.db, 'corporate_approval.revoked');
  expect(audit.map((row) => [row.installation_id, row.actor_github_id, row.subject_type, row.subject_id])).toEqual([
    [world.t1.installationId, 1234, 'corporate_approval', jane.id],
  ]);
  expect(audit[0]?.metadata).toEqual({
    kind: 'user',
    github_id: 7001,
    signature_id: world.adas.signatureId,
    reason_code: null,
  });
});

test.each([
  ['an empty object', {}, null],
  ['a reason with whitespace around it', { reason: '  left the company  ' }, 'left the company'],
  [
    'a reason of 500 characters',
    { reason: 'r'.repeat(REVOKE_REASON_MAX_CODE_POINTS) },
    'r'.repeat(REVOKE_REASON_MAX_CODE_POINTS),
  ],
  ['a reason of one symbol', { reason: '§' }, '§'],
] as const)('%s: the reason stored is %j', async (_label, body, stored) => {
  const { world, ids } = await withJane();
  expect(revokedOf(await revokeAs(world, world.ada, ids, body)).approval.revokeReason).toBe(stored);
});

test.each([
  ['an empty reason', { reason: '' }],
  ['a reason of whitespace only', { reason: ' \t ' }],
  ['a reason of 501 characters', { reason: 'r'.repeat(REVOKE_REASON_MAX_CODE_POINTS + 1) }],
  ['a reason with an address in it', { reason: 'Jane left, write to jane@acme.example' }],
  ['a reason with a control character', { reason: 'left\u0007' }],
])('%s is a 422 validation_failed on the field reason, and nothing is revoked', async (_label, body) => {
  const { world, ids } = await withJane();
  const before = await stateOf(world.db);
  const response = await revokeAs(world, world.ada, ids, body);
  expect(failureOf(response)).toEqual([422, 'validation_failed']);
  expect(detailsOf(response)).toEqual({ field: 'reason' });
  expect(await stateOf(world.db)).toEqual(before);
});

test.each([
  ['a reason that is not text', { reason: 12 }],
  ['a key the request does not know', { reason: 'left', approvalId: 1 }],
  ['a body that is not an object', 'left the company'],
])('%s is a 400 bad_request', async (_label, body) => {
  const { world, ids } = await withJane();
  expect(failureOf(await revokeAs(world, world.ada, ids, body))).toEqual([400, 'bad_request']);
});

test('the reason is kept with the revocation and in no audit row', async () => {
  const { world, ids } = await withJane();
  revokedOf(await revokeAs(world, world.ada, ids, { reason: 'zzzz reason' }));
  expect(JSON.stringify(await auditRowsOf(world.db, 'corporate_approval.revoked'))).not.toContain('zzzz');
  const stored = await storedApprovals(world.db, world.adas.id);
  expect(stored.map((row) => row.revoke_reason)).toContain('zzzz reason');
});

test('revoking twice is a 409 already_revoked, and the first revocation stands', async () => {
  const { world, ids } = await withJane();
  const first = revokedOf(await revokeAs(world, world.ada, ids, { reason: 'first' }));
  const before = await stateOf(world.db);
  expect(failureOf(await revokeAs(world, world.ada, ids, { reason: 'second' }))).toEqual([409, 'already_revoked']);
  expect(await stateOf(world.db)).toEqual(before);
  expect(first.approval.revokeReason).toBe('first');
});

test('a revoked approval can be given again: the subject is free once its approval is revoked, and the old row stays', async () => {
  const { world, jane, ids } = await withJane();
  revokedOf(await revokeAs(world, world.ada, ids));
  const again = addedOf(await addAs(world, world.ada, world.adas.id, { kind: 'user', login: 'jane-doe' }));
  expect(again.id).not.toBe(jane.id);
  const rows = (await storedApprovals(world.db, world.adas.id)).filter((row) => row.subject_github_id === 7001);
  expect(rows.map((row) => row.revoked_at === null)).toEqual([false, true]);
});

test('revoking a user approval revokes nothing else: the approvals derived from a domain stay', async () => {
  const { world } = await withJane();
  const signed = signedOf(world.c1, world.ada, world.adas);
  const domain = await approve(world.db, signed, { kind: 'email_domain', domain: 'acme.example' });
  const derived = await derive(world.db, signed, domain, { githubId: 7002, login: 'derived-login' });
  const ids = { agreementId: world.adas.id, approvalId: derived };
  expect(revokedOf(await revokeAs(world, world.ada, ids)).derivedRevoked).toBe(0);
  const states = await storedApprovals(world.db, world.adas.id);
  expect(states.find((row) => row.id === domain)?.revoked_at).toBeNull();
});

test.each([
  ['a domain', { kind: 'email_domain', domain: 'acme.example' }, null],
  ['an organisation', { kind: 'github_org', githubId: 9100, login: 'acme-org' }, 9100],
] as const)(
  'revoking %s revokes, in the same transaction, the approvals derived from it, one audit row each',
  async (_label, subject, orgId) => {
    const { world } = await withJane();
    const signed = signedOf(world.c1, world.ada, world.adas);
    const parent = await approve(world.db, signed, subject);
    const other = await approve(world.db, signed, { kind: 'email_domain', domain: 'other.example' });
    const derivedIds = [
      await derive(world.db, signed, parent, { githubId: 7101, login: 'one' }),
      await derive(world.db, signed, parent, { githubId: 7102, login: 'two' }),
    ];
    const kept = await derive(world.db, signed, other, { githubId: 7103, login: 'three' });
    const revoked = revokedOf(
      await revokeAs(world, world.ada, { agreementId: world.adas.id, approvalId: parent }, { reason: 'ended' }),
    );
    expect(revoked.derivedRevoked).toBe(2);
    const rows = await storedApprovals(world.db, world.adas.id);
    const revokedIds = rows.filter((row) => row.revoked_at !== null).map((row) => row.id);
    expect(revokedIds).toEqual([parent, ...derivedIds]);
    expect(rows.find((row) => row.id === kept)?.revoked_at).toBeNull();
    const derivedRows = rows.filter((row) => derivedIds.includes(row.id));
    // The derived rows carry no reason of their own: the manager's reason is about the approval they revoked.
    expect(derivedRows.map((row) => row.revoke_reason)).toEqual([null, null]);
    const audit = await auditRowsOf(world.db, 'corporate_approval.revoked');
    expect(audit.map((row) => [row.subject_id, row.metadata])).toEqual([
      [parent, { kind: subject.kind, github_id: orgId, signature_id: world.adas.signatureId, reason_code: null }],
      ...derivedIds.map((id, index) => [
        id,
        { kind: 'user', github_id: 7101 + index, signature_id: world.adas.signatureId, reason_code: 'parent_revoked' },
      ]),
    ]);
  },
);

test('a derived approval revoked on its own is not revoked a second time when its domain is revoked', async () => {
  const { world } = await withJane();
  const signed = signedOf(world.c1, world.ada, world.adas);
  const parent = await approve(world.db, signed, { kind: 'email_domain', domain: 'acme.example' });
  const early = await derive(world.db, signed, parent, { githubId: 7101, login: 'one' });
  const alreadyRevoked = revokedOf(await revokeAs(world, world.ada, { agreementId: world.adas.id, approvalId: early }));
  expect(alreadyRevoked.approval.state).toBe('revoked');
  const revoked = revokedOf(await revokeAs(world, world.ada, { agreementId: world.adas.id, approvalId: parent }));
  expect(revoked.derivedRevoked).toBe(0);
  expect(await auditRowsOf(world.db, 'corporate_approval.revoked')).toHaveLength(2);
});

test('an approval of another agreement, one that does not exist, and the agreement of someone else are the same 404', async () => {
  const { world, jane, ids } = await withJane();
  const bobsDomain = addedOf(
    await addAs(world, world.bob, world.bobs.id, { kind: 'email_domain', domain: 'bob.example' }),
  );
  const unknown = await revokeAs(world, world.ada, { agreementId: world.adas.id, approvalId: 987_654 });
  const crossed = [
    await revokeAs(world, world.ada, { agreementId: world.adas.id, approvalId: bobsDomain.id }),
    await revokeAs(world, world.bob, ids),
    await revokeAs(world, world.ada, { agreementId: world.bobs.id, approvalId: bobsDomain.id }),
    await revokeAs(world, world.ada, { agreementId: 987_654, approvalId: jane.id }),
  ];
  expect(failureOf(unknown)).toEqual([404, 'not_found']);
  expect(crossed.map(withoutRequestId)).toEqual(crossed.map(() => withoutRequestId(unknown)));
  expect((await storedApprovals(world.db, world.adas.id)).every((row) => row.revoked_at === null)).toBe(true);
});

test('a revoked agreement cannot be changed: 409 agreement_revoked, and no row', async () => {
  const { world, ids } = await withJane();
  await revokeSignature(world, world.adas.signatureId);
  const before = await stateOf(world.db);
  expect(failureOf(await revokeAs(world, world.ada, ids))).toEqual([409, 'agreement_revoked']);
  expect(await stateOf(world.db)).toEqual(before);
});

test('a suspended installation cannot be changed: 409 installation_suspended, and no row', async () => {
  const { world, ids } = await withJane();
  await suspendTenantOne(world);
  const before = await stateOf(world.db);
  expect(failureOf(await revokeAs(world, world.ada, ids))).toEqual([409, 'installation_suspended']);
  expect(await stateOf(world.db)).toEqual(before);
});

test('the id in the path must be a positive whole number', async () => {
  const { world } = await withJane();
  const response = await changeAs(world, world.ada, { method: 'DELETE', url: approvalUrl(world.adas.id, 'abc') });
  expect(failureOf(response)).toEqual([400, 'bad_request']);
});
