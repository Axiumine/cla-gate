// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  CORPORATE_AGREEMENT_PATH,
  CORPORATE_AGREEMENTS_PAGE_PATH,
  CORPORATE_AGREEMENTS_PATH,
  CORPORATE_DOCUMENT_PATH,
  CORPORATE_RULE_STATUS,
  CORPORATE_SIGN_PAGE_PATH,
  corporateAgreementCreateRoute,
  corporateAgreementListRoute,
  corporateAgreementRequestSchema,
  corporateAgreementRoute,
  corporateDocumentRoute,
  INSTALLATION_CORPORATE_AGREEMENTS_PATH,
  REPOSITORY_CORPORATE_DOCUMENT_PATH,
  repositoryCorporateDocumentRequestSchema,
  tenantAgreementSchema,
} from './corporate.ts';

// The contract of corporate signing (E21-S02): the paths the server and the pages share, the statuses of the rules, and the shape of
// the request.

const REQUEST = {
  githubRepoId: 9000,
  versionId: 3,
  contentSha256: 'a'.repeat(64),
  companyName: 'Acme',
  signatoryTitle: 'CEO',
  typedName: 'Ada Lovelace',
  authorityConfirmed: true,
};

test('the paths are the ones the story fixes', () => {
  expect([
    CORPORATE_DOCUMENT_PATH,
    CORPORATE_AGREEMENTS_PATH,
    CORPORATE_AGREEMENT_PATH,
    INSTALLATION_CORPORATE_AGREEMENTS_PATH,
    REPOSITORY_CORPORATE_DOCUMENT_PATH,
    CORPORATE_SIGN_PAGE_PATH,
    CORPORATE_AGREEMENTS_PAGE_PATH,
  ]).toEqual([
    '/api/corporate/repositories/:githubRepoId/document',
    '/api/corporate/agreements',
    '/api/corporate/agreements/:agreementId',
    '/api/installations/:installationId/corporate-agreements',
    '/api/installations/:installationId/repositories/:repositoryId/corporate-document',
    '/corporate/sign/:githubRepoId',
    '/corporate/agreements',
  ]);
});

test('the descriptors name their method and path', () => {
  expect(
    [corporateDocumentRoute, corporateAgreementCreateRoute, corporateAgreementListRoute, corporateAgreementRoute].map(
      (route) => [route.method, route.path],
    ),
  ).toEqual([
    ['GET', CORPORATE_DOCUMENT_PATH],
    ['POST', CORPORATE_AGREEMENTS_PATH],
    ['GET', CORPORATE_AGREEMENTS_PATH],
    ['GET', CORPORATE_AGREEMENT_PATH],
  ]);
});

test('every rule has the status the story gives it', () => {
  expect(CORPORATE_RULE_STATUS).toEqual({
    not_found: 404,
    corporate_cla_not_configured: 404,
    version_outdated: 409,
    hash_mismatch: 422,
    validation_failed: 422,
    agreement_exists: 409,
    agreement_revoked: 409,
    installation_suspended: 409,
    document_not_corporate: 422,
  });
});

test('a request is read with every key it has and with no key it does not', () => {
  expect(corporateAgreementRequestSchema.safeParse(REQUEST).success).toBe(true);
  for (const change of [
    { extra: 1 },
    { githubRepoId: 0 },
    { versionId: 1.5 },
    { contentSha256: 'A'.repeat(64) },
    { contentSha256: 'a'.repeat(63) },
    { authorityConfirmed: 'true' },
    { companyName: 1 },
  ]) {
    expect(corporateAgreementRequestSchema.safeParse({ ...REQUEST, ...change }).success, JSON.stringify(change)).toBe(
      false,
    );
  }
  for (const key of Object.keys(REQUEST)) {
    const rest = Object.fromEntries(Object.entries(REQUEST).filter(([name]) => name !== key));
    expect(corporateAgreementRequestSchema.safeParse(rest).success, key).toBe(false);
  }
});

test('the choice of a corporate document is an id or null and nothing else', () => {
  expect(repositoryCorporateDocumentRequestSchema.safeParse({ documentId: 3 }).success).toBe(true);
  expect(repositoryCorporateDocumentRequestSchema.safeParse({ documentId: null }).success).toBe(true);
  for (const body of [{}, { documentId: 0 }, { documentId: '3' }, { documentId: 3, extra: 1 }]) {
    expect(repositoryCorporateDocumentRequestSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
  }
});

test('an agreement of the tenant names the signatory by the numeric id and has no title', () => {
  const item = {
    id: 1,
    signatureId: 2,
    signedAt: '2026-11-05T10:00:00.000Z',
    major: 1,
    companyName: null,
    signatory: { githubId: 1234, login: null },
    activeApprovalCount: 0,
    revoked: false,
  };
  expect(tenantAgreementSchema.safeParse(item).success).toBe(true);
  expect(tenantAgreementSchema.safeParse({ ...item, signatoryTitle: 'CEO' }).success).toBe(false);
  expect(tenantAgreementSchema.safeParse({ ...item, signatory: { githubId: 0, login: null } }).success).toBe(false);
});
