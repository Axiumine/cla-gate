// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { pageQuerySchema } from './cla.ts';
import { defineRoute } from './contract.ts';
import { githubIdSchema } from './github-id.ts';

// The contract of corporate signing (E21-S02): the paths, the bodies and the answers of the routes through which a company signs a
// corporate CLA once, by an authorised signatory who becomes its CLA manager, and through which a maintainer sees the agreements of
// their tenant. The server registers the routes from these descriptors and the two screens (`/corporate/sign/:githubRepoId` and
// `/corporate/agreements`) call them by the same values. The text of a corporate CLA is the stored source (`contentMd`) and is never
// rendered on the server: the page renders it through the sanitised renderer of E12. The names of the company and of the signatory
// are erasable personal data, so every answer that holds one is `null` once they were erased.

/**
 * `GET`: the corporate CLA in force for a repository, by the numeric id GitHub gave it. Any signed-in person may read it.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export const CORPORATE_DOCUMENT_PATH = '/api/corporate/repositories/:githubRepoId/document';

/**
 * `POST` signs a corporate CLA for a company; `GET` lists the agreements the signed-in person signed (their own and nobody's else).
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export const CORPORATE_AGREEMENTS_PATH = '/api/corporate/agreements';

/**
 * `GET`: one agreement of the signed-in person. Any agreement that is not theirs is a `404`, the same as an id that names nothing.
 */
export const CORPORATE_AGREEMENT_PATH = `${CORPORATE_AGREEMENTS_PATH}/:agreementId`;

/** `GET`: the agreements of one tenant, for an org admin of it. `:installationId` is `installations.id`. */
export const INSTALLATION_CORPORATE_AGREEMENTS_PATH = '/api/installations/:installationId/corporate-agreements';

/** `PUT`: choose the corporate CLA document of a repository, or remove it. `:repositoryId` is `repositories.id`. */
export const REPOSITORY_CORPORATE_DOCUMENT_PATH =
  '/api/installations/:installationId/repositories/:repositoryId/corporate-document';

/**
 * The page of the single-page app where a signatory signs, for the repository GitHub's id names. Not an API route.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export const CORPORATE_SIGN_PAGE_PATH = '/corporate/sign/:githubRepoId';

/**
 * The page of the single-page app that lists the agreements of the signed-in person. Not an API route.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export const CORPORATE_AGREEMENTS_PAGE_PATH = '/corporate/agreements';

const id = z.int().positive();

/** An instant as ISO 8601 in UTC with milliseconds, which is what `Date.prototype.toISOString` writes. */
const instant = z.iso.datetime({ offset: false });

const sha256 = z.string().regex(/^[0-9a-f]{64}$/u);

/**
 * The rules a corporate request can break after the repository was found, each with the status the API answers with. The code is the
 * `code` of the error body. `corporate_cla_not_configured` is a repository that has no corporate CLA in force (none chosen, no
 * published version, or enforcement off); `version_outdated` and `hash_mismatch` say that the page must be loaded again and that the
 * text it sent is not the text of the version it names; `validation_failed` is a company name or title the rules refuse, or an
 * authority that was not confirmed; `agreement_exists` is a second agreement of the same person for the same document and major;
 * `agreement_revoked` is a manager action on an agreement whose signature was revoked; `installation_suspended` a write for a
 * suspended tenant; `document_not_corporate` is the one answer for every document a repository may not take as its corporate CLA
 * (unknown, another tenant's, another repository's, or of another kind); `not_found` is the one answer for an agreement that is not
 * the caller's, whoever's it is. The rest are the rules of the approvals of E21-S03: `github_user_not_found` and `github_org_not_found`
 * are a login GitHub has no such account or organisation for, `not_a_user` an account that is not a person, `domain_not_allowed` a
 * free-mail domain, `approval_limit` an agreement that has its 500 approvals in force, `approval_exists` a subject that has one in
 * force, `already_revoked` an approval that was revoked, and `upstream_unavailable` GitHub failing (a rate limit, a refusal, an
 * outage) with nothing written; a rate limit tells its wait in the `retry-after` header. The claim of an employee (E21-S04) has one
 * rule of its own: `no_matching_approval` is a person no agreement of the repository's tenant covers by an approval of their own, by
 * the domain of a verified address or by an organisation they show a membership of; it names no company.
 */
export const CORPORATE_RULE_STATUS = {
  not_found: 404,
  corporate_cla_not_configured: 404,
  version_outdated: 409,
  hash_mismatch: 422,
  validation_failed: 422,
  agreement_exists: 409,
  agreement_revoked: 409,
  installation_suspended: 409,
  document_not_corporate: 422,
  github_user_not_found: 422,
  github_org_not_found: 422,
  not_a_user: 422,
  domain_not_allowed: 422,
  approval_limit: 422,
  approval_exists: 409,
  already_revoked: 409,
  upstream_unavailable: 503,
  no_matching_approval: 409,
} as const;

export type CorporateRule = keyof typeof CORPORATE_RULE_STATUS;

/** The path parameter of the corporate CLA of a repository: GitHub's numeric id of the repository. */
export const corporateDocumentParamsSchema = z.object({ githubRepoId: id });

/** The path parameter of one agreement: `corporate_agreements.id`. */
export const corporateAgreementParamsSchema = z.object({ agreementId: id });

/**
 * The corporate CLA in force for a repository: the document, the version with its exact stored text, the hash the signing request
 * must send back, and the consent sentence the signature will store (its id and its text, as the page shows it beside the box).
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export const corporateDocumentResponseSchema = z.strictObject({
  repository: z.strictObject({ githubRepoId: id, fullName: z.string() }),
  document: z.strictObject({ id, name: z.string() }),
  versionId: id,
  major: z.int().nonnegative(),
  minor: z.int().nonnegative(),
  contentMd: z.string(),
  contentSha256: sha256,
  publishedAt: instant,
  consent: z.strictObject({ id: z.string().min(1), text: z.string().min(1) }),
});

export type CorporateDocumentResponse = z.infer<typeof corporateDocumentResponseSchema>;

/**
 * The body of the signing request. Strict: a key the schema does not know is an error. The texts are plain text here on purpose: what
 * makes them acceptable (the cleaning, the limits, the characters that are refused) is judged after the checks on the version, in
 * that order, and answers with its own code (`422`), not with the `400` of a malformed body. `authorityConfirmed` is the box the
 * signatory ticks to say they may bind the company; it must be `true`.
 */
export const corporateAgreementRequestSchema = z.strictObject({
  githubRepoId: id,
  versionId: id,
  contentSha256: sha256,
  companyName: z.string(),
  signatoryTitle: z.string(),
  typedName: z.string(),
  authorityConfirmed: z.boolean(),
});

export type CorporateAgreementRequest = z.infer<typeof corporateAgreementRequestSchema>;

/**
 * What the `201` answer names: the agreement and its signature, the version it was signed under and when. Never a name, a title or an address.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export const corporateAgreementCreatedSchema = z.strictObject({
  agreement: z.strictObject({ id, signatureId: id, versionId: id, major: z.int().positive(), signedAt: instant }),
});

export type CorporateAgreementCreated = z.infer<typeof corporateAgreementCreatedSchema>;

/**
 * One agreement as its signatory sees it. `companyName` and `signatoryTitle` are `null` once the signatory was erased; `revoked` is
 * true when the signature of the agreement was revoked, and then every manager action on it is a `409 agreement_revoked`.
 * `activeApprovalCount` counts the approvals that are neither revoked nor expired.
 */
const corporateAgreementSchema = z.strictObject({
  id,
  signatureId: id,
  signedAt: instant,
  major: z.int().positive(),
  companyName: z.string().nullable(),
  signatoryTitle: z.string().nullable(),
  document: z.strictObject({ id, name: z.string() }),
  installation: z.strictObject({ accountLogin: z.string() }),
  activeApprovalCount: z.int().nonnegative(),
  revoked: z.boolean(),
});

export type CorporateAgreement = z.infer<typeof corporateAgreementSchema>;

/**
 * A page of the agreements of the signed-in person, newest first. `nextCursor` is opaque and is `null` on the last page.
 *
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export const corporateAgreementPageSchema = z.strictObject({
  items: z.array(corporateAgreementSchema),
  nextCursor: z.string().nullable(),
});

/**
 * The body of the answer for one agreement.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export const corporateAgreementDetailSchema = z.strictObject({ agreement: corporateAgreementSchema });

/**
 * One agreement as an org admin sees it: the signatory by the numeric GitHub id, with the login snapshot (`null` once erased), the
 * signature to revoke it by (E15-S03), the number of approvals in force and whether the agreement was revoked.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export const tenantAgreementSchema = z.strictObject({
  id,
  signatureId: id,
  signedAt: instant,
  major: z.int().positive(),
  companyName: z.string().nullable(),
  signatory: z.strictObject({ githubId: githubIdSchema, login: z.string().nullable() }),
  activeApprovalCount: z.int().nonnegative(),
  revoked: z.boolean(),
});

export type TenantAgreement = z.infer<typeof tenantAgreementSchema>;

/**
 * A page of the agreements of a tenant, newest first.
 */
export const tenantAgreementPageSchema = z.strictObject({
  items: z.array(tenantAgreementSchema),
  nextCursor: z.string().nullable(),
});

export type CorporateAgreementPage = z.infer<typeof corporateAgreementPageSchema>;

export type TenantAgreementPage = z.infer<typeof tenantAgreementPageSchema>;

/**
 * The body of the choice of the corporate CLA of a repository: the `cla_documents.id` to take, or `null` to remove the choice. A
 * repository with none accepts individual signatures only.
 */
export const repositoryCorporateDocumentRequestSchema = z.strictObject({ documentId: id.nullable() });

/** The answer: the document the repository has now (`null` after a removal) and whether the call changed anything. */
export const repositoryCorporateDocumentResponseSchema = z.strictObject({
  documentId: id.nullable(),
  changed: z.boolean(),
});

/**
 * `GET /api/corporate/repositories/:githubRepoId/document` (E21-S02): the corporate CLA in force for the repository. `404`
 * `corporate_cla_not_configured` when the repository has none or is not enabled, `404` `not_found` for a repository that does not
 * exist or whose organisation is not served. Reads keep working while the installation is suspended.
 */
export const corporateDocumentRoute = defineRoute({
  method: 'GET',
  path: CORPORATE_DOCUMENT_PATH,
  params: corporateDocumentParamsSchema,
  responses: { 200: corporateDocumentResponseSchema },
});

/**
 * `POST /api/corporate/agreements` (E21-S02): the signatory signs for the company; `201` with the agreement. Anything else is the
 * standard error body: `400` for a body that is not the schema, `401` without a session, the codes of
 * {@link CORPORATE_RULE_STATUS} and those of the name and the address (`SIGNER_RULE_STATUS`).
 */
export const corporateAgreementCreateRoute = defineRoute({
  method: 'POST',
  path: CORPORATE_AGREEMENTS_PATH,
  body: corporateAgreementRequestSchema,
  responses: { 201: corporateAgreementCreatedSchema },
});

/** `GET /api/corporate/agreements?limit=<1..100>&cursor=<opaque>` (E21-S02): the agreements of the person of the session, newest first. */
export const corporateAgreementListRoute = defineRoute({
  method: 'GET',
  path: CORPORATE_AGREEMENTS_PATH,
  query: pageQuerySchema,
  responses: { 200: corporateAgreementPageSchema },
});

/** `GET /api/corporate/agreements/:agreementId` (E21-S02): one agreement of the person of the session; `404` `not_found` for any other. */
export const corporateAgreementRoute = defineRoute({
  method: 'GET',
  path: CORPORATE_AGREEMENT_PATH,
  params: corporateAgreementParamsSchema,
  responses: { 200: corporateAgreementDetailSchema },
});
