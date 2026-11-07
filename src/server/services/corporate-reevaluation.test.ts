// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import type { PrEvaluationDetails } from '../../shared/pr-evaluation-details.ts';
import { corporateTenant } from '../adapters/db/corporate-fixture/test-support.ts';
import { rowId } from '../adapters/db/test-support.ts';
import { agreementBasisNeedle, approvalBasisNeedle } from '../domain/affected-prs.ts';
import { successDetails } from '../domain/failure-details-fixture/test-support.ts';
import { listEnforcingRepositories } from './cla-enforcing-queries.ts';
import { findAgreementOfSignature } from './corporate-agreement-of-signature.ts';
import { reevaluateAfterApprovalRevocation } from './corporate-approval-reevaluate.ts';
import { sentJobs } from './jobs-fixture/test-support.ts';
import { revocationWorld, sentAs, storePr } from './revocation-fixture/test-support.ts';
import { reevaluateAfterRevocation } from './signature-reevaluate.ts';

// What the revocation of a corporate signature or approval asks for (E21-S05): the open pull requests whose success rested on it are evaluated
// again, found by the numbers the stored result holds, in the repositories that enforce the corporate document, and nobody else's.

const SIGNER = 4711;

/** A success whose author `githubId` is covered by the approval `approvalId` of the agreement `agreementId`. */
function coveredByApproval(githubId: number, agreementId: number, approvalId: number): PrEvaluationDetails {
  return {
    ...successDetails([]),
    actors: [
      {
        githubId,
        roles: ['author'],
        covered: true,
        basis: { kind: 'corporate_approval', agreementId, approvalId },
      },
    ],
  };
}

/** Tenant 1 with a corporate document its plain repository enforces, and an agreement with approvals; pull requests 61 to 63 rest on its approvals. */
async function world() {
  const base = await revocationWorld();
  const { db, t1 } = base;
  const corporate = await corporateTenant(db, t1, SIGNER);
  await db
    .updateTable('repositories')
    .set({ corporate_document_id: corporate.document.documentId, cla_document_id: null })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  const agreementId = corporate.signed.agreementId;
  await storePr(db, t1, 'plain', {
    prNumber: 61,
    details: coveredByApproval(70, agreementId, corporate.employeeApproval),
  });
  await storePr(db, t1, 'plain', {
    prNumber: 62,
    details: coveredByApproval(71, agreementId, corporate.derivedApproval),
  });
  await storePr(db, t1, 'plain', { prNumber: 63, details: coveredByApproval(72, agreementId + 1000, 999_999) });
  const scope = { installationId: t1.installationId };
  const revoke = (change: Parameters<typeof reevaluateAfterApprovalRevocation>[3]) =>
    db.transaction().execute((trx) => reevaluateAfterApprovalRevocation(trx, base.queue, scope, change));
  return { ...base, corporate, agreementId, scope, revoke };
}

test('the needles are the actor covered by a corporate approval that names the approval, or the agreement', () => {
  expect(JSON.parse(approvalBasisNeedle(9))).toEqual({
    actors: [{ covered: true, basis: { kind: 'corporate_approval', approvalId: 9 } }],
  });
  expect(JSON.parse(agreementBasisNeedle(5))).toEqual({
    actors: [{ covered: true, basis: { kind: 'corporate_approval', agreementId: 5 } }],
  });
});

test('the revocation of a user approval evaluates again the pull request that rested on that approval, keyed by it, and no other', async () => {
  const { db, t1, corporate, agreementId, revoke } = await world();
  const sent = await revoke({
    documentId: corporate.document.documentId,
    agreementId,
    approvalId: corporate.employeeApproval,
    kind: 'user',
    derivedRevoked: 0,
  });
  expect(sent).toBe(1);
  expect(await sentAs(db)).toEqual([`${t1.plain.githubRepoId}#61`]);
  expect((await sentJobs(db)).map((entry) => entry.idempotencyKey)).toEqual([
    `corporate_approval_revoked:${corporate.employeeApproval}:${t1.plain.githubRepoId}:61`,
  ]);
  expect((await sentJobs(db)).map((entry) => entry.job)).toEqual([
    expect.objectContaining({ type: 'evaluate-pr', trigger: 'signature', prNumber: 61 }),
  ]);
});

test.each(['email_domain', 'github_org'] as const)(
  'the revocation of a %s approval with approvals derived from it evaluates again every pull request that rests on the agreement',
  async (kind) => {
    const { db, t1, corporate, agreementId, revoke } = await world();
    const sent = await revoke({
      documentId: corporate.document.documentId,
      agreementId,
      approvalId: corporate.domainApproval,
      kind,
      derivedRevoked: 1,
    });
    expect(sent).toBe(2);
    expect(await sentAs(db)).toEqual([`${t1.plain.githubRepoId}#61`, `${t1.plain.githubRepoId}#62`]);
  },
);

test.each(['email_domain', 'github_org'] as const)(
  'the revocation of a %s approval that took nothing with it asks for nothing: it covered nobody itself',
  async (kind) => {
    const { db, corporate, agreementId, revoke, queue } = await world();
    const sent = await revoke({
      documentId: corporate.document.documentId,
      agreementId,
      approvalId: corporate.domainApproval,
      kind,
      derivedRevoked: 0,
    });
    expect(sent).toBe(0);
    expect(queue.calls).toEqual([]);
    expect(await sentAs(db)).toEqual([]);
  },
);

test('only the repositories that enforce the corporate document of the agreement are looked at', async () => {
  const { db, t1, corporate, agreementId, revoke } = await world();
  await db
    .updateTable('repositories')
    .set({ corporate_document_id: null })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  const sent = await revoke({
    documentId: corporate.document.documentId,
    agreementId,
    approvalId: corporate.employeeApproval,
    kind: 'user',
    derivedRevoked: 0,
  });
  expect(sent).toBe(0);
  expect(await sentAs(db)).toEqual([]);
});

test('the revocation of the signature of an agreement evaluates again every pull request that rests on one of its approvals, and not those of another agreement', async () => {
  const { db, t1, scope, corporate, queue } = await world();
  const sent = await db.transaction().execute((trx) =>
    reevaluateAfterRevocation(trx, queue, scope, {
      id: corporate.signed.signatureId,
      documentId: corporate.document.documentId,
      versionId: corporate.document.versionId,
      major: corporate.document.major,
      signerGithubId: parseGithubId(SIGNER),
    }),
  );
  expect(sent).toBe(2);
  expect(await sentAs(db)).toEqual([`${t1.plain.githubRepoId}#61`, `${t1.plain.githubRepoId}#62`]);
});

test('the repositories that enforce a corporate document are listed with it, as the repositories that enforce an individual one are', async () => {
  const { db, t1, scope, corporate } = await world();
  const repositories = await listEnforcingRepositories(db, scope, corporate.document.documentId);
  expect(repositories.map((repository) => repository.repositoryId)).toEqual([t1.plain.repositoryId]);
  expect(
    await listEnforcingRepositories(db, { installationId: rowId(987_654) }, corporate.document.documentId),
  ).toEqual([]);
});

test('the agreement of a signature is found for the consent of an agreement, and is nothing for an individual signature or another tenant', async () => {
  const { db, t1, t2, scope, corporate, agreementId } = await world();
  expect(await findAgreementOfSignature(db, scope, corporate.signed.signatureId)).toBe(agreementId);
  expect(await findAgreementOfSignature(db, scope, t1.signatureId)).toBeNull();
  expect(
    await findAgreementOfSignature(db, { installationId: t2.installationId }, corporate.signed.signatureId),
  ).toBeNull();
  expect(await findAgreementOfSignature(db, scope, 987_654)).toBeNull();
});
