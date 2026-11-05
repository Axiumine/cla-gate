// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { defineRoute } from './contract.ts';
import { corporateDocumentParamsSchema } from './corporate.ts';

// The contract of the claim of an employee (E21-S04): a contributor who writes for an employer asks to be covered by the corporate CLA
// the employer signed, and the platform answers from what the employer's CLA manager approved (E21-S03), never from what the contributor
// says. Two routes: whether the repository offers the claim at all, which the signing page reads to decide whether to show the entry
// ("Contributing for an employer?"), and the claim itself. Neither answer ever names a company, an agreement or an approval: a
// contributor learns whether they are covered and nothing about who else is.

/**
 * `GET`: whether a contributor may claim coverage for a repository, by the numeric id GitHub gave it. Any signed-in person may read it.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export const CORPORATE_AVAILABILITY_PATH = '/api/corporate/repositories/:githubRepoId/availability';

/**
 * `POST`: the claim of the signed-in person for a repository, by the numeric id GitHub gave it.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export const CORPORATE_CLAIMS_PATH = '/api/corporate/repositories/:githubRepoId/claims';

/**
 * The page of the single-page app where a contributor claims coverage, for the repository GitHub's id names. Not an API route.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export const CORPORATE_CLAIM_PAGE_PATH = '/corporate/claim/:githubRepoId';

/**
 * The text the `409 no_matching_approval` answer carries in `details.hint`: fixed, the same for every repository and every person, and
 * naming no company. The `message` of the error body stays the status text, as for every error of the API.
 */
export const NO_MATCHING_APPROVAL_HINT =
  "No agreement covers you yet. Ask your employer's CLA manager to approve your GitHub account, your e-mail domain or your GitHub organisation, then try again.";

/**
 * What the availability answers: whether the repository has a corporate CLA and at least one agreement in force under it.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export const corporateAvailabilitySchema = z.strictObject({ corporateAvailable: z.boolean() });

/** The body of a claim: the confirmation that the person contributes for an employer, which must be `true`. Anything else is a `400`. */
export const corporateClaimRequestSchema = z.strictObject({ confirm: z.literal(true) });

/**
 * The `201` answer: a rule matched and the person is covered from now on, for as long as the approval it derives from stays in force.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export const corporateClaimCoveredSchema = z.strictObject({ status: z.literal('covered') });

/**
 * The `200` answer: the person already had an approval in force, so nothing was written.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export const corporateClaimAlreadyCoveredSchema = z.strictObject({ status: z.literal('already_covered') });

/**
 * `GET /api/corporate/repositories/:githubRepoId/availability` (E21-S04): `{ "corporateAvailable": true }` only when the repository has a
 * corporate CLA in force and at least one agreement under it that is in force (its signature is not revoked and it was signed under the
 * major in force). `false` for everything else, including a repository that does not exist or whose organisation is not served, so
 * the answer says nothing of which tenants exist. Reads keep working while the installation is suspended.
 */
export const corporateAvailabilityRoute = defineRoute({
  method: 'GET',
  path: CORPORATE_AVAILABILITY_PATH,
  params: corporateDocumentParamsSchema,
  responses: { 200: corporateAvailabilitySchema },
});

/**
 * `POST /api/corporate/repositories/:githubRepoId/claims` (E21-S04) with `{ "confirm": true }`: `201 { "status": "covered" }` when a
 * rule matched and an approval was derived for the person, `200 { "status": "already_covered" }` when they already had one, and
 * `409 no_matching_approval` when nothing covers them. Anything else is the standard error body: `400` for a body that is not the
 * schema, `401` without a session, `429` with `Retry-After` past 10 claims an hour, `503 upstream_unavailable` when GitHub could not
 * say, and the codes of the target of E21-S02 (`404 not_found`, `404 corporate_cla_not_configured`, `409 installation_suspended`).
 */
export const corporateClaimRoute = defineRoute({
  method: 'POST',
  path: CORPORATE_CLAIMS_PATH,
  params: corporateDocumentParamsSchema,
  body: corporateClaimRequestSchema,
  responses: { 200: corporateClaimAlreadyCoveredSchema, 201: corporateClaimCoveredSchema },
});
