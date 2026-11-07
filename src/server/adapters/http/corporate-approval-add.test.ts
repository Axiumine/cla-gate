// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  addAs,
  addedOf,
  approvalWorld,
  auditRowsOf,
  JANE,
  storedApprovals,
} from './corporate-approval-fixture/test-support.ts';
import { ANY_NUMBER, failureOf, UTC_INSTANT } from './corporate-fixture/test-support.ts';

// Adding an approval (E21-S03): the signatory names a person, an organisation or an e-mail domain; the answer is the `201` approval, the
// subject is stored by numeric id (a domain by its normal form), the login is a display snapshot in its own table, and one audit row
// carries numeric ids and the kind only. Ada signed for tenant 1, so every lookup is made on the installation of tenant 1.

test.each([
  [
    'a person, found as typed in any case and stored as GitHub keeps the login',
    { kind: 'user', login: ' jane-doe ' },
    { kind: 'user', githubId: 7001, domain: null, login: 'Jane-Doe' },
    ['getUserAccount'],
  ],
  [
    'an organisation',
    { kind: 'github_org', login: 'acme-org' },
    { kind: 'github_org', githubId: 9100, domain: null, login: 'Acme-Org' },
    ['getOrganizationAccount'],
  ],
  [
    'a domain, lower-cased and trimmed, with no GitHub call at all',
    { kind: 'email_domain', domain: 'Acme.com ' },
    { kind: 'email_domain', githubId: null, domain: 'acme.com', login: null },
    [],
  ],
] as const)(
  '%s: 201 with the approval, one row, one login snapshot, one audit row',
  async (_label, body, shown, calls) => {
    const world = await approvalWorld();
    const approval = addedOf(await addAs(world, world.ada, world.adas.id, body));
    expect(approval).toEqual({
      id: ANY_NUMBER,
      source: 'manager',
      state: 'active',
      derivedFromApprovalId: null,
      approvedAt: UTC_INSTANT,
      expiresAt: null,
      revokedAt: null,
      revokeReason: null,
      ...shown,
    });
    const rows = await storedApprovals(world.db, world.adas.id);
    // Ada's own approval from signing comes first; the new one is the manager's decision.
    expect(rows.map((row) => [row.id, row.kind, row.subject_github_id, row.subject_domain, row.source])).toEqual([
      [rows[0]?.id, 'user', 1234, null, 'manager'],
      [approval.id, shown.kind, shown.githubId, shown.domain, 'manager'],
    ]);
    const pii = await world.db
      .selectFrom('corporate_approval_pii')
      .select('login')
      .where('approval_id', '=', approval.id)
      .execute();
    expect(pii).toEqual(shown.login === null ? [] : [{ login: shown.login }]);
    expect(world.github.calls.map((call) => [call.method, call.installationId])).toEqual(
      calls.map((method) => [method, world.t1.githubInstallationId]),
    );
    const audit = await auditRowsOf(world.db, 'corporate_approval.added');
    expect(audit.map((row) => [row.installation_id, row.actor_github_id, row.subject_type, row.subject_id])).toEqual([
      [world.t1.installationId, 1234, 'corporate_approval', approval.id],
    ]);
    expect(audit[0]?.metadata).toEqual({
      kind: shown.kind,
      github_id: shown.githubId,
      signature_id: world.adas.signatureId,
      reason_code: null,
    });
  },
);

test('the audit row holds ids and the kind, never a login or a domain', async () => {
  const world = await approvalWorld();
  world.github.scriptUserAccount('zzzz-login', { ...JANE, login: 'zzzz-login' });
  addedOf(await addAs(world, world.ada, world.adas.id, { kind: 'user', login: 'zzzz-login' }));
  addedOf(await addAs(world, world.ada, world.adas.id, { kind: 'email_domain', domain: 'zzzz-corp.example' }));
  const audit = await auditRowsOf(world.db, 'corporate_approval.added');
  expect(audit).toHaveLength(2);
  expect(JSON.stringify(audit)).not.toContain('zzzz');
});

test('the same approval twice is a 409 approval_exists, and the second attempt writes nothing', async () => {
  const world = await approvalWorld();
  const first = addedOf(await addAs(world, world.ada, world.adas.id, { kind: 'email_domain', domain: 'acme.com' }));
  const again = await addAs(world, world.ada, world.adas.id, { kind: 'email_domain', domain: 'ACME.com' });
  expect(failureOf(again)).toEqual([409, 'approval_exists']);
  expect((await storedApprovals(world.db, world.adas.id)).filter((row) => row.id !== first.id)).toHaveLength(1);
  expect(await auditRowsOf(world.db, 'corporate_approval.added')).toHaveLength(1);
});

test('a person approved under another login of the same account is the same approval: the identity is the numeric id', async () => {
  const world = await approvalWorld();
  addedOf(await addAs(world, world.ada, world.adas.id, { kind: 'user', login: 'jane-doe' }));
  world.github.scriptUserAccount('jane-renamed', { ...JANE, login: 'jane-renamed' });
  const renamed = await addAs(world, world.ada, world.adas.id, { kind: 'user', login: 'jane-renamed' });
  expect(failureOf(renamed)).toEqual([409, 'approval_exists']);
});
