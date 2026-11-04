// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { PAGE_SIZE } from './cla.ts';
import { defineRoute } from './contract.ts';
import { prNumberSchema } from './sign-context.ts';

// The contract of the list of a person's own signatures (E13-S06): every CLA the signed-in person signed, in every org of the
// instance, and whether each one still covers them. The server registers the route from this descriptor and the "my signatures"
// screen (E18) calls it by the same value. The subject is the person of the session and nobody can be named: the query string
// holds the page and nothing else. An item names the org, the document, the version and the pull request; it never holds the
// name or the address the person typed, the reason of a revocation or the person who revoked.

/** Where a signed-in person lists the CLAs they signed. */
export const OWN_SIGNATURES_PATH = '/api/me/signatures';

/**
 * The longest `cursor` the server reads: the cursor it makes is about 70 characters, and a longer text is not one of its own.
 * The same bound as the other paged lists (`pageQuerySchema`).
 */
const MAX_CURSOR_LENGTH = 1024;

/**
 * Where a signature stands: `active` (it covers the person for the version in force, or the document has none yet),
 * `outdated` (a later major version is in force) or `revoked`. The server decides it with one function (`signatureState`).
 *
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export const OWN_SIGNATURE_STATES = ['active', 'outdated', 'revoked'] as const;

/** @internal Exported for the tests (Knip ignores `@internal` exports in production mode). */
export type OwnSignatureState = (typeof OWN_SIGNATURE_STATES)[number];

/** An instant as ISO 8601 in UTC with milliseconds, which is what `Date.prototype.toISOString` writes. */
const instant = z.iso.datetime({ offset: false });

const id = z.int().positive();

/** The page asked for: how many items (`limit`, 1 to 100, 50 when absent) and where to start (the `nextCursor` of the page before). Any other key is an error. */
const ownSignaturesQuerySchema = z.strictObject({
  limit: z.int().min(1).max(PAGE_SIZE.max).optional(),
  cursor: z.string().min(1).max(MAX_CURSOR_LENGTH).optional(),
});

/** Where to sign again: the sign page of a repository, by the numeric id GitHub gave it. */
const RESIGN_PATH = /^\/sign\/[1-9]\d*$/u;

/**
 * One signature of the person. `installation` is the org (or account) whose CLA it is: `suspended` is true while the App is
 * suspended there, and the item stays listed. `source` is where the person signed from, `null` for a signature that has none; its
 * `prNumber` is `null` when they signed from the dashboard. `revokedAt` is set exactly when `state` is `revoked`, and `resignPath`
 * is `null` for an `active` signature and, for an outdated or revoked one, when no repository of the document can take the person
 * to the sign page.
 *
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export const ownSignatureSchema = z
  .strictObject({
    id,
    installation: z.strictObject({
      accountLogin: z.string(),
      accountType: z.enum(['Organization', 'User', 'Other']),
      suspended: z.boolean(),
    }),
    document: z.strictObject({ id, name: z.string() }),
    version: z.strictObject({ id, major: z.int().nonnegative(), minor: z.int().nonnegative() }),
    signedAt: instant,
    source: z.strictObject({ repositoryFullName: z.string(), prNumber: prNumberSchema.nullable() }).nullable(),
    state: z.enum(OWN_SIGNATURE_STATES),
    revokedAt: instant.nullable(),
    resignPath: z.string().regex(RESIGN_PATH).nullable(),
  })
  .refine((item) => (item.state === 'revoked') === (item.revokedAt !== null), {
    message: 'revokedAt is set exactly when the state is revoked',
  })
  .refine((item) => item.state !== 'active' || item.resignPath === null, {
    message: 'an active signature has nothing to sign again',
  });

/**
 * A page of the list, newest first. `nextCursor` is opaque and is `null` on the last page.
 *
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export const ownSignaturesPageSchema = z.strictObject({
  items: z.array(ownSignatureSchema),
  nextCursor: z.string().nullable(),
});

export type OwnSignaturesPage = z.infer<typeof ownSignaturesPageSchema>;

/**
 * `GET /api/me/signatures?limit=<1..100>&cursor=<opaque>` (E13-S06): the signatures of the person of the session, newest first
 * (`signed_at desc, id desc`), in every tenant. Without a session it is a `401`; a parameter this schema does not name, a `limit`
 * out of range and a cursor the server did not make are each a `400`. A person with no signatures gets an empty page.
 */
export const ownSignaturesRoute = defineRoute({
  method: 'GET',
  path: OWN_SIGNATURES_PATH,
  query: ownSignaturesQuerySchema,
  responses: { 200: ownSignaturesPageSchema },
});
