// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import {
  INVALIDATION_PREVIEW_PATH,
  INVALIDATIONS_PATH,
  type InvalidationPreviewResponse,
  type InvalidationResponse,
  invalidationPreviewQuerySchema,
  invalidationPreviewResponseSchema,
  invalidationRequestSchema,
  invalidationResponseSchema,
} from '../../../shared/signature-invalidate.ts';
import type { JobEnqueuer } from '../../services/ports/jobs.ts';
import { invalidateMajor } from '../../services/signature-invalidate.ts';
import { previewInvalidation } from '../../services/signature-invalidate-preview.ts';
import type { Database } from '../db/schema.ts';
import { requireAuth } from './auth-request.ts';
import { answerRuleErrors } from './cla-rule-errors.ts';
import { CLA_BODY_LIMIT } from './limits.ts';
import { setNoStore } from './no-store.ts';
import { parseInput } from './request-body.ts';
import { requireTenant, tenantAccess } from './tenant-access.ts';
import { byDocumentParam, documentIdOf } from './tenant-resolvers.ts';

export interface SignatureInvalidateRoutesOptions {
  readonly db: Kysely<Database>;
  /** Where the sweeps of the repositories that enforce the document are sent (E15-S04). */
  readonly enqueuer: JobEnqueuer;
}

/**
 * The two routes that invalidate a major of a document (E15-S04), both `tenant` routes resolved by `byDocumentParam`: the requirement
 * follows the scope of the document (an org admin for an installation-wide one, an admin of the repository for a repository's), a
 * stranger gets the uniform `404`, and the other tenant's document id is `404` too. The query and the body are read in the handler
 * after the guard, so a stranger learns nothing of how they are read.
 *
 * `GET …/documents/:documentId/invalidation-preview?major=<n>` counts what the invalidation would do (the signatures in force, the
 * repositories it would sweep) and names no person. It is a read, and it records nothing.
 *
 * `POST …/documents/:documentId/invalidations` with `{ major, reasonCode, expectedCount }` revokes every signature of the major in force
 * in one transaction, audited once as `signatures.invalidated`, which also sends the sweeps; a count that is not `expectedCount` is
 * `409 count_changed` and a major with nothing in force `409 nothing_to_invalidate`. There is no route to undo it.
 */
export const signatureInvalidateRoutes: FastifyPluginCallbackZod<SignatureInvalidateRoutesOptions> = (
  app,
  options,
  done,
) => {
  const { db, enqueuer } = options;
  answerRuleErrors(app);
  app.get(
    INVALIDATION_PREVIEW_PATH,
    {
      // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { response: { 200: invalidationPreviewResponseSchema } },
      config: { access: tenantAccess({ mode: 'read', resolve: byDocumentParam(db) }) },
    },
    async (request, reply): Promise<InvalidationPreviewResponse> => {
      const tenant = requireTenant(request);
      const { major } = parseInput(invalidationPreviewQuerySchema, request.query);
      const preview = await previewInvalidation(db, tenant, { documentId: documentIdOf(request), major });
      setNoStore(reply);
      return { major, ...preview };
    },
  );
  app.post(
    INVALIDATIONS_PATH,
    {
      bodyLimit: CLA_BODY_LIMIT,
      // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { response: { 200: invalidationResponseSchema } },
      config: {
        access: tenantAccess({ mode: 'write', resolve: byDocumentParam(db) }),
        audit: 'signatures.invalidated',
      },
    },
    async (request, reply): Promise<InvalidationResponse> => {
      const tenant = requireTenant(request);
      const body = parseInput(invalidationRequestSchema, request.body);
      const { user } = requireAuth(request);
      const invalidated = await invalidateMajor({ db, enqueuer }, tenant, {
        documentId: documentIdOf(request),
        major: body.major,
        reason: body.reasonCode,
        expectedCount: body.expectedCount,
        actor: { userId: user.id, githubId: user.githubId },
      });
      setNoStore(reply);
      return { invalidated };
    },
  );
  done();
};
