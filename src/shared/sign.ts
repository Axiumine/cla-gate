// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { defineRoute } from './contract.ts';
import { prNumberSchema, signatureViewSchema } from './sign-context.ts';

// The contract of the sign request (E13-S04): what the sign page sends when a contributor consents, and what it gets back. The
// request names the exact version the person read (its id and the SHA-256 of its text) and the consent sentence by its id, so the
// signature is recorded against what was on screen and never against whatever is current when the request arrives. The server
// registers the route from this descriptor and the sign page (E18) calls it by the same value.

const id = z.int().positive();

/**
 * The path of the sign request. The sign page (E18) calls it; until then the tests are its callers.
 *
 * @internal
 */
export const SIGN_PATH = '/api/sign';

/** The longest id of a consent sentence (`CONSENT_TEXTS`, E13-S01): it always fits `signatures.consent_text_id`. */
const CONSENT_ID_MAX_LENGTH = 64;

/**
 * The body of the sign request. Strict: a key the schema does not know is an error, not something that is quietly dropped.
 * `name` and `email` are plain text here on purpose: what makes them acceptable (the cleaning of the name, the address being one
 * the session verified) is judged after the checks on the version, in that order, and answers with its own codes (`422`), not
 * with the `400` of a malformed body (`signerInputSchema`, `resolveSignerEmail`).
 */
export const signRequestSchema = z.strictObject({
  githubRepoId: id,
  prNumber: prNumberSchema.optional(),
  versionId: id,
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  consentTextId: z.string().min(1).max(CONSENT_ID_MAX_LENGTH),
  name: z.string(),
  email: z.string(),
});

export type SignRequest = z.infer<typeof signRequestSchema>;

/**
 * The signature the answer names: its id, the version it was made under and when. Never a name, an address or a login.
 *
 * @internal
 */
export const signedSignatureSchema = signatureViewSchema.extend({ versionId: id });

/**
 * The body of the `201` and `200` answers. `created` is `false` when a non-revoked signature for the document and major version
 * existed already (a double submit, a minor version of a major the person signed): the answer then names that signature.
 *
 * @internal
 */
export const signResponseSchema = z.strictObject({ signature: signedSignatureSchema, created: z.boolean() });

/**
 * The answer as a type, for the sign page (E18).
 *
 * @internal
 */
export type SignResponse = z.infer<typeof signResponseSchema>;

/**
 * The rules the sign request can break after the repository was found, each with the status the API answers with. The code is the
 * `code` of the error body. `stale_version` and `stale_consent` say that the page must be loaded again; `hash_mismatch` that the
 * text the page sent is not the text of the version it names; `unsupported_document_kind` that the document is not an individual
 * CLA (corporate signing is E21).
 */
export const SIGN_REFUSAL_STATUS = {
  stale_version: 409,
  hash_mismatch: 422,
  stale_consent: 409,
  unsupported_document_kind: 409,
} as const;

export type SignRefusalRule = keyof typeof SIGN_REFUSAL_STATUS;

/**
 * What the `details` of a `stale_version` answer hold: the version in force, so the page can reload it.
 *
 * @internal
 */
export const currentVersionSchema = z.strictObject({
  versionId: id,
  major: z.int().nonnegative(),
  minor: z.int().nonnegative(),
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/u),
});

export type CurrentVersion = z.infer<typeof currentVersionSchema>;

/**
 * `POST /api/sign` (E13-S04): records the signature of the person of the session, with the name they typed and one of their
 * verified e-mail addresses, in one transaction. `201` with `created: true` for a new signature; `200` with `created: false` and
 * the existing signature for a repeat. Anything else is the standard error body: `400` for a body that is not this schema, `401`
 * without a session, `404` for a repository that does not exist or whose organisation is not served, `409` `no_active_cla`, and
 * the codes of {@link SIGN_REFUSAL_STATUS} and of the name and the address (`SIGNER_RULE_STATUS`).
 */
export const signRoute = defineRoute({
  method: 'POST',
  path: SIGN_PATH,
  body: signRequestSchema,
  responses: { 200: signResponseSchema, 201: signResponseSchema },
});
