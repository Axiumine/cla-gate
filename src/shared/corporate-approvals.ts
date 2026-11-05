// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { defineRoute } from './contract.ts';
import { CORPORATE_AGREEMENT_PATH } from './corporate.ts';
import { githubIdSchema } from './github-id.ts';

// The contract of the approvals of a corporate agreement (E21-S03): the CLA manager (the signatory of the agreement) decides who is
// covered by it, by GitHub account, by e-mail domain or by GitHub organisation. The paths, the bodies and the answers are here; the
// server registers its routes from these descriptors. An approval names a numeric GitHub id (a person or an organisation) or a domain;
// the login that goes with an id is a display snapshot and is `null` once the person was erased. Nothing here is personal data but
// that login.

/**
 * `GET` lists the approvals of one agreement of the signed-in person, `POST` adds one.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export const CORPORATE_APPROVALS_PATH = `${CORPORATE_AGREEMENT_PATH}/approvals`;

/**
 * `DELETE` revokes one approval of an agreement.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export const CORPORATE_APPROVAL_PATH = `${CORPORATE_APPROVALS_PATH}/:approvalId`;

/**
 * `POST` copies the manager's approvals of an earlier agreement to this one.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export const CORPORATE_CARRY_OVER_PATH = `${CORPORATE_APPROVALS_PATH}/carry-over`;

/** The most approvals in force (neither revoked nor expired) an agreement may have. */
export const APPROVAL_LIMIT = 500;

/** The size of a page of approvals: the default, and the most a request may ask for. */
export const APPROVAL_PAGE_SIZE = { default: 50, max: 200 } as const;

/** The most characters of the reason of a revocation; the column holds as many. */
export const REVOKE_REASON_MAX_CODE_POINTS = 500;

/**
 * The shape of the login of a GitHub organisation: a letter or digit and up to 38 more letters, digits or hyphens. A person's login has
 * the same shape (and a bot's the suffix `[bot]`, which no organisation has).
 */
export const GITHUB_ORG_LOGIN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;

const id = z.int().positive();

/** An instant as ISO 8601 in UTC with milliseconds, which is what `Date.prototype.toISOString` writes. */
const instant = z.iso.datetime({ offset: false });

/** What an approval covers: one account, every address at one domain, or every public member of one organisation. */
const approvalKindSchema = z.enum(['user', 'email_domain', 'github_org']);

export type ApprovalKind = z.infer<typeof approvalKindSchema>;

/**
 * The body of `POST .../approvals`: the kind and the one value that kind needs, as the manager typed it. Strict, and the texts are
 * plain strings on purpose: what makes them acceptable (the shape of a login, the form of a domain, the free-mail list) is judged after
 * the agreement was found, and answers `422` with its own code, not the `400` of a malformed body. A login is looked up on GitHub and
 * stored by its numeric id.
 */
export const approvalRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('user'), login: z.string() }),
  z.strictObject({ kind: z.literal('email_domain'), domain: z.string() }),
  z.strictObject({ kind: z.literal('github_org'), login: z.string() }),
]);

export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;

/** The path parameter of the approvals of one agreement. */
export const approvalsParamsSchema = z.object({ agreementId: id });

/** The path parameters of one approval of an agreement. */
export const approvalParamsSchema = z.object({ agreementId: id, approvalId: id });

/**
 * The query of the list: a plain-digit `limit` of 1 to 200 (50 when absent) and the `cursor` an earlier page answered with.
 */
export const approvalPageQuerySchema = z.strictObject({
  limit: z
    .string()
    .regex(/^[1-9]\d{0,2}$/)
    .transform(Number)
    .pipe(z.int().max(APPROVAL_PAGE_SIZE.max))
    .optional(),
  cursor: z.string().min(1).max(1024).optional(),
});

/**
 * The body of `DELETE .../approvals/:approvalId`: an optional reason, 1 to 500 characters after cleaning. The reason is kept with the
 * revocation, which nobody can edit or erase afterwards, so it must hold no personal data: no name, no address.
 */
export const approvalRevokeRequestSchema = z.strictObject({ reason: z.string().optional() });

/** The body of `POST .../approvals/carry-over`: the earlier agreement of the same signatory and document whose approvals are copied. */
export const carryOverRequestSchema = z.strictObject({ fromAgreementId: id });

/**
 * One approval as the manager sees it. `state` is `revoked` once it was revoked, else `expired` once `expiresAt` has passed (only an
 * approval derived by a rule expires), else `active`. `githubId` is the account or organisation, `domain` the e-mail domain; the other
 * one is `null`. `login` is the display snapshot of the account and `null` for a domain and once the person was erased.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export const approvalSchema = z.strictObject({
  id,
  kind: approvalKindSchema,
  source: z.enum(['manager', 'rule']),
  state: z.enum(['active', 'expired', 'revoked']),
  githubId: githubIdSchema.nullable(),
  domain: z.string().nullable(),
  login: z.string().nullable(),
  derivedFromApprovalId: id.nullable(),
  approvedAt: instant,
  expiresAt: instant.nullable(),
  revokedAt: instant.nullable(),
  revokeReason: z.string().nullable(),
});

export type Approval = z.infer<typeof approvalSchema>;

/**
 * The `201` answer of an added approval: the approval, with its id.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export const approvalCreatedSchema = z.strictObject({ approval: approvalSchema });

/**
 * A page of approvals, newest first, active and revoked alike; `nextCursor` is opaque and `null` on the last page.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export const approvalPageSchema = z.strictObject({
  items: z.array(approvalSchema),
  nextCursor: z.string().nullable(),
});

export type ApprovalPage = z.infer<typeof approvalPageSchema>;

/**
 * The answer of a revocation: the approval as it now stands and how many approvals derived from it were revoked with it.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export const approvalRevokedSchema = z.strictObject({
  approval: approvalSchema,
  derivedRevoked: z.int().nonnegative(),
});

export type ApprovalRevoked = z.infer<typeof approvalRevokedSchema>;

/**
 * The answer of a carry-over: how many approvals were copied and how many the agreement had already.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export const carryOverResultSchema = z.strictObject({
  copied: z.int().nonnegative(),
  skipped: z.int().nonnegative(),
});

/**
 * `POST /api/corporate/agreements/:agreementId/approvals` (E21-S03): the signatory adds an approval; `201` with it. Only the signatory
 * of the agreement may call it, anybody else gets `404 not_found`. The codes of the rules are those of `CORPORATE_RULE_STATUS`.
 */
export const approvalCreateRoute = defineRoute({
  method: 'POST',
  path: CORPORATE_APPROVALS_PATH,
  params: approvalsParamsSchema,
  body: approvalRequestSchema,
  responses: { 201: approvalCreatedSchema },
});

/** `GET /api/corporate/agreements/:agreementId/approvals?limit=<1..200>&cursor=<opaque>` (E21-S03): the approvals of the agreement, newest first. */
export const approvalListRoute = defineRoute({
  method: 'GET',
  path: CORPORATE_APPROVALS_PATH,
  params: approvalsParamsSchema,
  query: approvalPageQuerySchema,
  responses: { 200: approvalPageSchema },
});

/** `DELETE /api/corporate/agreements/:agreementId/approvals/:approvalId` (E21-S03): revokes the approval, and the approvals derived from it. */
export const approvalRevokeRoute = defineRoute({
  method: 'DELETE',
  path: CORPORATE_APPROVAL_PATH,
  params: approvalParamsSchema,
  body: approvalRevokeRequestSchema,
  responses: { 200: approvalRevokedSchema },
});

/** `POST /api/corporate/agreements/:agreementId/approvals/carry-over` (E21-S03): copies the manager's approvals of an earlier major. */
export const carryOverRoute = defineRoute({
  method: 'POST',
  path: CORPORATE_CARRY_OVER_PATH,
  params: approvalsParamsSchema,
  body: carryOverRequestSchema,
  responses: { 200: carryOverResultSchema },
});
