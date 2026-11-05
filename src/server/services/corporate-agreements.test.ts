// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { corporateTenant, personWithId } from '../adapters/db/corporate-fixture/test-support.ts';
import { twoTenants } from '../adapters/db/tenant-fixture/test-support.ts';
import { migratedTestDatabase } from '../adapters/db/test-support.ts';
import {
  listOwnAgreements,
  listTenantAgreements,
  readOwnAgreement,
  requireManagedAgreement,
} from './corporate-agreements.ts';
import { CorporateRuleError } from './corporate-rule-error.ts';

// What the CLA manager and the org admin read of the agreements (E21-S02), below the routes. The authority of a manager is being the
// signatory of an agreement that is not revoked, in a tenant that is served: `requireManagedAgreement` is the check the mutations of
// the approvals (E21-S03) start from.

const SIGNATORY = 8001;

async function world() {
  const { db } = await migratedTestDatabase();
  const tenants = await twoTenants(db);
  const corporate = await corporateTenant(db, tenants.t1, SIGNATORY);
  const signatory = await personWithId(db, SIGNATORY);
  const stranger = await personWithId(db, 8002);
  return { db, ...tenants, corporate, signatory, stranger, agreementId: corporate.signed.agreementId };
}

/** The rule a call broke, or `null` when it did not break one. */
async function ruleOf(attempt: Promise<unknown>): Promise<string | null> {
  try {
    await attempt;
    return null;
  } catch (error) {
    if (error instanceof CorporateRuleError) {
      return error.rule;
    }
    throw error;
  }
}

test('a rule error names its rule and its details and nothing else', () => {
  const plain = new CorporateRuleError('agreement_revoked');
  const detailed = new CorporateRuleError('validation_failed', { field: 'companyName' });
  expect([plain.rule, plain.message, plain.name, plain.details]).toEqual([
    'agreement_revoked',
    'agreement_revoked',
    'CorporateRuleError',
    undefined,
  ]);
  expect(detailed.details).toEqual({ field: 'companyName' });
  expect(detailed).toBeInstanceOf(Error);
});

test('the signatory manages the agreement: it is returned with its tenant and the approvals in force', async () => {
  const { db, signatory, agreementId } = await world();
  const agreement = await requireManagedAgreement(db, signatory.userId, agreementId);
  expect(agreement).toMatchObject({
    id: agreementId,
    revokedAt: null,
    signatoryGithubId: SIGNATORY,
    companyName: 'Acme Corp',
    accountLogin: 'org-1',
    activeApprovals: 5,
  });
});

test('anybody else, and an agreement that does not exist, is not_found', async () => {
  const { db, stranger, agreementId } = await world();
  expect(await ruleOf(requireManagedAgreement(db, stranger.userId, agreementId))).toBe('not_found');
  expect(await ruleOf(requireManagedAgreement(db, stranger.userId, 987_654))).toBe('not_found');
  expect(await ruleOf(readOwnAgreement(db, stranger.userId, agreementId))).toBe('not_found');
});

test('a revoked agreement is read by the signatory and refused to a manager action with agreement_revoked', async () => {
  const { db, signatory, corporate, t1, agreementId } = await world();
  await db
    .updateTable('signatures')
    .set({ revoked_at: new Date(Date.now() + 1000), revoked_by: t1.publisherId, revoke_reason: 'maintainer_decision' })
    .where('id', '=', corporate.signed.signatureId)
    .execute();
  expect((await readOwnAgreement(db, signatory.userId, agreementId)).revokedAt).toBeInstanceOf(Date);
  expect(await ruleOf(requireManagedAgreement(db, signatory.userId, agreementId))).toBe('agreement_revoked');
});

test.each([
  ['suspended', { suspended_at: new Date('2026-10-01T00:00:00Z') }, 'installation_suspended'],
  ['uninstalled', { deleted_at: new Date('2026-10-01T00:00:00Z') }, 'not_found'],
  ['rejected', { admission_status: 'rejected' as const, admission_reason: 'policy_changed' as const }, 'not_found'],
])(
  'an agreement of an installation that is %s is %s for a manager action and is read as usual',
  async (_state, change, rule) => {
    const { db, signatory, t1, agreementId } = await world();
    await db.updateTable('installations').set(change).where('id', '=', t1.installationId).execute();
    expect(await ruleOf(requireManagedAgreement(db, signatory.userId, agreementId))).toBe(rule);
    expect((await readOwnAgreement(db, signatory.userId, agreementId)).id).toBe(agreementId);
  },
);

test('the state of the tenant is judged before the revocation: a revoked agreement of a suspended tenant is installation_suspended', async () => {
  const { db, signatory, corporate, t1, agreementId } = await world();
  await db
    .updateTable('signatures')
    .set({ revoked_at: new Date(Date.now() + 1000), revoked_by: t1.publisherId, revoke_reason: 'maintainer_decision' })
    .where('id', '=', corporate.signed.signatureId)
    .execute();
  await db
    .updateTable('installations')
    .set({ suspended_at: new Date('2026-10-01T00:00:00Z') })
    .where('id', '=', t1.installationId)
    .execute();
  expect(await ruleOf(requireManagedAgreement(db, signatory.userId, agreementId))).toBe('installation_suspended');
});

test('the lists are pages of limit rows with the position of the first row left out, and the lists of nobody else', async () => {
  const { db, signatory, stranger, t1, t2, agreementId } = await world();
  const second = await corporateTenant(db, t2, SIGNATORY);
  const own = await listOwnAgreements(db, signatory.userId, { limit: 1, from: null });
  expect(own.items.map((item) => item.id)).toEqual([second.signed.agreementId]);
  expect(own.next).toEqual({ id: agreementId });
  const rest = await listOwnAgreements(db, signatory.userId, { limit: 1, from: own.next });
  expect([rest.items.map((item) => item.id), rest.next]).toEqual([[agreementId], null]);
  expect(await listOwnAgreements(db, stranger.userId, { limit: 5, from: null })).toEqual({ items: [], next: null });
  const tenant = await listTenantAgreements(db, { installationId: t1.installationId }, { limit: 5, from: null });
  expect(tenant.items.map((item) => item.id)).toEqual([agreementId]);
});
