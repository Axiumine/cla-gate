// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { githubIdSchema } from './github-id.ts';
import { prNumberSchema } from './sign-context.ts';

// The search for signatures a maintainer acts on (E15-S02): the path, the states a search may ask for and the shape of a page. The
// route, its tests and the screen that revokes a signature (E18) share them. The query string is read by the route
// (src/server/adapters/http/signature-search-query.ts), because the cursor format is the server's own.

/**
 * Where a maintainer looks signatures up: `:installationId` is `installations.id`, the tenant key of our own tables, never
 * GitHub's installation id (E11-S05).
 */
export const SIGNATURES_PATH = '/api/installations/:installationId/signatures';

/** The longest `login` a search takes: GitHub's logins have at most 39 characters, so a longer text finds nothing and is a `400`. */
export const SIGNATURE_SEARCH_MAX_LOGIN = 100;

const id = z.int().positive();

/** An instant as ISO 8601 in UTC with milliseconds, which is what `Date.prototype.toISOString` writes. */
const instant = z.iso.datetime({ offset: false });

/** The reasons a revocation may carry: the database check on `signatures.revoke_reason`. */
const revokeReason = z.enum(['signer_request', 'maintainer_decision', 'legal_request', 'other']);

/**
 * One signature as a maintainer sees it. `signer` is the personal data the signer gave (`signer_pii`), verbatim and not escaped
 * here: it is `null` once that data was erased (E16-S04), and then `piiErased` is `true`; `githubUserId` is the identity key and is
 * always present. `revokedAt`, `revokedByGithubId` and `revokeReasonCode` are set together, exactly when `state` is `revoked`.
 * `source` is where the person signed from, `null` for a signature that has none; its `prNumber` is `null` for one signed from the
 * dashboard.
 */
const signatureSearchItemSchema = z
  .strictObject({
    id,
    githubUserId: githubIdSchema,
    document: z.strictObject({ id, name: z.string() }),
    version: z.strictObject({ major: z.int().nonnegative(), minor: z.int().nonnegative() }),
    signedAt: instant,
    source: z.strictObject({ repositoryFullName: z.string(), prNumber: prNumberSchema.nullable() }).nullable(),
    state: z.enum(['active', 'outdated', 'revoked']),
    revokedAt: instant.nullable(),
    revokedByGithubId: githubIdSchema.nullable(),
    revokeReasonCode: revokeReason.nullable(),
    signer: z.strictObject({ login: z.string(), name: z.string(), email: z.string() }).nullable(),
    piiErased: z.boolean(),
  })
  .refine((item) => (item.state === 'revoked') === (item.revokedAt !== null), {
    message: 'revokedAt is set exactly when the state is revoked',
  })
  .refine((item) => item.piiErased === (item.signer === null), {
    message: 'piiErased is true exactly when there is no signer',
  });

/**
 * A page of the search, newest signature first. `nextCursor` is opaque and is `null` on the last page. `truncated` is `true` when
 * the viewer, who is a repository admin and not an org admin, has more repositories with signatures than one request checks (50):
 * the page then lists the signatures of the repositories that were checked, and `documentId` names the one to look at.
 */
export const signatureSearchPageSchema = z.strictObject({
  items: z.array(signatureSearchItemSchema),
  nextCursor: z.string().nullable(),
  truncated: z.boolean(),
});

export type SignatureSearchPage = z.infer<typeof signatureSearchPageSchema>;
