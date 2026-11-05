// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';

// The contract of revoking a signature (E15-S03): the path, the reason codes, the body and the answer. The route, its tests and the
// screen that revokes a signature (E18) share them. Revocation is prospective and has no undo: the signature stops covering the
// pull requests evaluated from now on, contributions already accepted stay licensed, and a person who should be covered again signs
// again (a new row, E13-S04).

/** `POST`: revoke one signature of a tenant (E15-S03). `:installationId` is `installations.id`, `:signatureId` is `signatures.id`. */
export const SIGNATURE_REVOKE_PATH = '/api/installations/:installationId/signatures/:signatureId/revoke';

/**
 * The reasons a revocation may carry: the database check on `signatures.revoke_reason` (migration 001). A revoked row can never be
 * edited, so the reason is a code from this fixed set and never free text or personal data.
 */
const REVOKE_REASON_CODES = ['signer_request', 'maintainer_decision', 'legal_request', 'other'] as const;

export const revokeReasonSchema = z.enum(REVOKE_REASON_CODES);

/** The body of a revocation: the reason code and nothing else (a key nobody defined is a `400`). */
export const signatureRevokeRequestSchema = z.strictObject({ reasonCode: revokeReasonSchema });

/**
 * The answer: the signature as it is now (`state` is always `revoked`, with the instant the database stamped, ISO 8601 in UTC) and
 * how many re-evaluation jobs the revocation asked for (one per open pull request that relied on the signature, or one sweep per
 * repository above 100 of them).
 */
export const signatureRevokeResponseSchema = z.strictObject({
  signature: z.strictObject({
    id: z.int().positive(),
    state: z.literal('revoked'),
    revokedAt: z.iso.datetime({ offset: false }),
  }),
  reevaluating: z.int().nonnegative(),
});

export type SignatureRevokeResponse = z.infer<typeof signatureRevokeResponseSchema>;
