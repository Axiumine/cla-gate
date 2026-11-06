// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { seedSignatures } from '../../services/export/export-fixture/test-support.ts';
import { eraseSigner } from '../../services/signer-erasure.ts';
import { corporateTenant, derive, PEOPLE } from '../db/corporate-fixture/test-support.ts';
import { ADA, adaWorld, rawDocument } from './data-export-fixture/test-support.ts';

// What the export of a person's own data holds of the corporate CLA (E21): the agreements the person signed for a company and the
// approvals that name them, in every tenant, with the login snapshot and the company they gave until it is erased, and nothing of
// another person: not who approved, not who revoked, not the note a manager typed. Whose data it may be is data-export-tenants.test.ts.

/** Any text: the instant of an event and the name of a document are not what these tests pin. */
const ANY_STRING: unknown = expect.any(String);
const ADA_PII = { login: 'ada', name: 'Ada Lovelace', email: 'ada@example.test' };

/**
 * Ada's world with a corporate CLA in both tenants: she signed it for her company in tenant 1, where she is also approved by herself, and
 * she is approved by a rule in tenant 2 (an approval derived from the domain of that company).
 */
async function corporate() {
  const state = await adaWorld();
  const { db, t1, t2 } = state;
  const own = await corporateTenant(db, t1, ADA, { companyName: 'Lovelace Engines', signatoryTitle: 'Founder' });
  const other = await corporateTenant(db, t2, t2.signer.githubId, {
    companyName: 'Babbage Works',
    signatoryTitle: 'Zzzz',
  });
  const byRule = await derive(db, other.signed, other.domainApproval, { githubId: ADA, login: 'ada-by-rule' });
  return { ...state, own, other, byRule };
}

test('the agreement Ada signed and the approvals that name her, newest first, in both tenants: what each one is and none of the others', async () => {
  const { exportedAda, own, other, byRule, t1, t2 } = await corporate();
  const document = await exportedAda();
  expect(document.corporateAgreements).toEqual([
    {
      id: own.signed.agreementId,
      signatureId: own.signed.signatureId,
      installation: { githubInstallationId: t1.githubInstallationId, accountLogin: 'org-1' },
      document: { id: own.document.documentId, name: ANY_STRING },
      major: own.document.major,
      signedAt: ANY_STRING,
      revokedAt: null,
      personalData: { companyName: 'Lovelace Engines', signatoryTitle: 'Founder' },
    },
  ]);
  expect(document.corporateApprovals.map((approval) => [approval.id, approval.source, approval.login])).toEqual([
    [byRule, 'rule', 'ada-by-rule'],
    [own.ownApproval, 'manager', `login-${ADA}`],
  ]);
  expect(document.corporateApprovals[0]).toEqual({
    id: byRule,
    agreementId: other.signed.agreementId,
    installation: { githubInstallationId: t2.githubInstallationId, accountLogin: 'org-2' },
    document: { id: other.document.documentId, name: ANY_STRING },
    major: other.document.major,
    source: 'rule',
    approvedAt: ANY_STRING,
    expiresAt: ANY_STRING,
    revokedAt: null,
    login: 'ada-by-rule',
  });
  expect(document.corporateApprovals[1]).toMatchObject({ source: 'manager', expiresAt: null });
});

test('nothing in the corporate part names another person: not who approved, not who revoked, not the note, not the other companies or employees', async () => {
  const { db, getAda, other, t2 } = await corporate();
  await db
    .updateTable('corporate_approvals')
    .set({
      revoked_at: new Date(Date.now() + 60_000),
      revoked_by: t2.signer.userId,
      revoke_reason: 'zzzz typed by the manager',
    })
    .where('id', '=', other.employeeApproval)
    .execute();
  const response = await getAda();
  const body = rawDocument(response.json());
  expect(Object.keys(body.corporateAgreements[0] ?? {})).toEqual([
    'id',
    'signatureId',
    'installation',
    'document',
    'major',
    'signedAt',
    'revokedAt',
    'personalData',
  ]);
  expect(Object.keys(body.corporateApprovals[0] ?? {})).toEqual([
    'id',
    'agreementId',
    'installation',
    'document',
    'major',
    'source',
    'approvedAt',
    'expiresAt',
    'revokedAt',
    'login',
  ]);
  for (const foreign of [
    'approved_by',
    'revoked_by',
    'zzzz',
    'Babbage Works',
    'employee-login',
    'derived-login',
    'acme.example',
    'acme-org',
  ]) {
    expect(response.body, foreign).not.toContain(foreign);
  }
  expect(response.body).not.toContain(String(PEOPLE.employee));
});

test('a revoked approval shows with the instant of its revocation, and a revoked signature of the agreement shows on the agreement', async () => {
  const { db, exportedAda, own, byRule, t1 } = await corporate();
  await db
    .updateTable('corporate_approvals')
    .set({
      revoked_at: new Date('2026-12-01T00:00:00.000Z'),
      revoked_by: t1.signer.userId,
      revoke_reason: 'left the company',
    })
    .where('id', '=', byRule)
    .execute();
  await db
    .updateTable('signatures')
    .set({ revoked_at: new Date('2026-12-02T00:00:00.000Z'), revoked_by: t1.signer.userId, revoke_reason: 'other' })
    .where('id', '=', own.signed.signatureId)
    .execute();
  const document = await exportedAda();
  expect(document.corporateApprovals.find((approval) => approval.id === byRule)?.revokedAt).toBe(
    '2026-12-01T00:00:00.000Z',
  );
  expect(document.corporateAgreements[0]?.revokedAt).toBe('2026-12-02T00:00:00.000Z');
});

test('after the erasure in one tenant the company, the title and the login are gone there, the rows stay, and the other tenant still has its login', async () => {
  const { db, exportedAda, own, byRule, people, t1, t2 } = await corporate();
  // A signature in the other tenant keeps her personal data there, so the erasure in this one does not end her session.
  await seedSignatures(db, t2, [{ githubId: ADA, pii: ADA_PII, signedAtMs: 0 }]);
  await eraseSigner(
    db,
    { installationId: t1.installationId },
    { githubUserId: parseGithubId(ADA), expectedRows: 1, actor: parseGithubId(people.admin1.githubId) },
  );
  const document = await exportedAda();
  expect(document.corporateAgreements.map((agreement) => [agreement.id, agreement.personalData])).toEqual([
    [own.signed.agreementId, null],
  ]);
  expect(
    document.corporateApprovals.map((approval) => [approval.installation.accountLogin, approval.login === null]),
  ).toEqual([
    ['org-2', false],
    ['org-1', true],
  ]);
  expect(document.corporateApprovals.map((approval) => approval.id)).toContain(byRule);
});

test('a person who signed no corporate CLA and is approved under none has two empty lists, and the signatory of the other tenant has only their own', async () => {
  const { exported, other, people } = await corporate();
  for (const who of ['member1', 'outsider'] as const) {
    const document = await exported(who);
    expect([who, document.corporateAgreements, document.corporateApprovals]).toEqual([who, [], []]);
  }
  const signatory = await exported('admin2');
  expect(signatory.corporateAgreements.map((agreement) => [agreement.id, agreement.personalData?.companyName])).toEqual(
    [[other.signed.agreementId, 'Babbage Works']],
  );
  expect(signatory.corporateApprovals.map((approval) => [approval.id, approval.login])).toEqual([
    [other.ownApproval, `login-${people.admin2.githubId}`],
  ]);
});
