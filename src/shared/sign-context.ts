// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { defineRoute } from './contract.ts';
import { githubIdSchema } from './github-id.ts';
import { MAX_PR_NUMBER } from './sign-link.ts';
import { verifiedEmailsSchema } from './verified-email.ts';

// The contract of the sign page context (E13-S02): everything the page needs in one read. Which CLA version applies to a
// repository, what the viewer already signed and which verified e-mail addresses they can choose. The server registers the
// route from this descriptor and the sign page (E18) calls it by the same value. The text of the CLA is the stored source
// (`contentMd`), never rendered here or on the server: the page renders it.

/** An instant as ISO 8601 in UTC with milliseconds, which is what `Date.prototype.toISOString` writes. */
const instant = z.iso.datetime({ offset: false });

const id = z.int().positive();

/** A pull request number: an integer from 1 to {@link MAX_PR_NUMBER}, the range of `pr_evaluations.pr_number`. */
export const prNumberSchema = z.int().min(1).max(MAX_PR_NUMBER);

/** The path parameter: GitHub's numeric id of the repository, which stays the same when the repository is renamed or transferred. */
export const signContextParamsSchema = z.object({ githubRepoId: id });

/** The query string: the pull request the person came from, when they came from one. Any other key is an error. */
const signContextQuerySchema = z.strictObject({ pr: prNumberSchema.optional() });

/**
 * Where the viewer stands on the version in force: `ready` to sign (nothing covers them, or only revoked signatures
 * exist), `already_signed` (a signature of the same major version covers them, whatever its minor) or `resign_required` (they
 * signed an earlier major version and the document moved on).
 *
 * @internal
 */
export const SIGN_STATES = ['ready', 'already_signed', 'resign_required'] as const;

export type SignState = (typeof SIGN_STATES)[number];

/**
 * Why the viewer cannot sign yet. The one reason today: GitHub reported no verified e-mail address at login.
 *
 * @internal
 */
export const SIGN_BLOCKED_REASONS = ['no_verified_email'] as const;

/** A signature that covers or once covered the viewer. Who revoked a signature and why is never part of it. */
const signatureViewSchema = z.strictObject({
  id,
  major: z.int().nonnegative(),
  minor: z.int().nonnegative(),
  signedAt: instant,
});

/** The viewer's newest revoked signature on the document: when it was made and when it ended, and nothing about who or why. */
const revokedViewSchema = z.strictObject({
  major: z.int().nonnegative(),
  signedAt: instant,
  revokedAt: instant,
});

/**
 * The body of the `200` answer.
 *
 * @internal
 */
export const signContextResponseSchema = z.strictObject({
  repository: z.strictObject({ githubRepoId: id, fullName: z.string(), accountLogin: z.string() }),
  document: z.strictObject({ id, name: z.string() }),
  version: z.strictObject({
    id,
    major: z.int().nonnegative(),
    minor: z.int().nonnegative(),
    contentMd: z.string(),
    contentSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    rationale: z.string(),
    publishedAt: instant,
  }),
  consent: z.strictObject({ id: z.string().min(1), text: z.string().min(1) }),
  emails: verifiedEmailsSchema,
  viewer: z.strictObject({ githubId: githubIdSchema, login: z.string() }),
  pr: prNumberSchema.nullable(),
  prUrl: z.string().nullable(),
  state: z.enum(SIGN_STATES),
  signature: signatureViewSchema.nullable(),
  revoked: revokedViewSchema.nullable(),
  canSign: z.boolean(),
  blockedReason: z.enum(SIGN_BLOCKED_REASONS).nullable(),
});

export type SignContextResponse = z.infer<typeof signContextResponseSchema>;

/**
 * `GET /api/sign/:githubRepoId` with the optional `?pr=<n>` (E13-S02). A signed-in person may ask for any repository; the
 * tenant is the one that owns the repository's CLA document. Without a session it is a `401`, and the answer is never a
 * redirect. An unknown repository and one of an installation that is suspended, uninstalled or not admitted are the same
 * `404`; a repository with no CLA in force is a `409` `no_active_cla`.
 */
export const signContextRoute = defineRoute({
  method: 'GET',
  path: '/api/sign/:githubRepoId',
  params: signContextParamsSchema,
  query: signContextQuerySchema,
  responses: { 200: signContextResponseSchema },
});
