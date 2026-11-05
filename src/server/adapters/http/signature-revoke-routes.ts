// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import {
  SIGNATURE_REVOKE_PATH,
  type SignatureRevokeResponse,
  signatureRevokeRequestSchema,
  signatureRevokeResponseSchema,
} from '../../../shared/signature-revoke.ts';
import type { JobEnqueuer } from '../../services/ports/jobs.ts';
import { revokeSignature } from '../../services/signature-revoke.ts';
import type { Database } from '../db/schema.ts';
import { requireAuth } from './auth-request.ts';
import { answerRuleErrors } from './cla-rule-errors.ts';
import { setNoStore } from './no-store.ts';
import { parseInput } from './request-body.ts';
import { requireTenant, tenantAccess } from './tenant-access.ts';
import { bySignatureParam, idText, paramsOf } from './tenant-resolvers.ts';

const signatureParams = z.object({ signatureId: idText });

export interface SignatureRevokeRoutesOptions {
  readonly db: Kysely<Database>;
  /** Where the jobs that evaluate the affected pull requests again are sent (E15-S03). */
  readonly enqueuer: JobEnqueuer;
}

/**
 * `POST /api/installations/:installationId/signatures/:signatureId/revoke` (E15-S03) with `{ reasonCode }`: takes one signature out of
 * force for the evaluations from now on. A `tenant` route in `write` mode, so a stranger gets the uniform `404`, a suspended tenant
 * `409 installation_suspended`, and the role is asked of GitHub again; the requirement follows the scope of the signature's document
 * (`bySignatureParam`): an org admin for an installation-wide one, an admin of the repository for a repository's, the same signature
 * under another tenant's path being `404`. The body is read in the handler after the guard, so a stranger learns nothing of how it is
 * read; a reason code outside the four of the database check is `400`. Audited as `signature.revoked`, in the transaction of the
 * revocation, which also sends the jobs; a signature that is revoked already, by a simultaneous call too, is `409 already_revoked`.
 * There is no route to un-revoke, to change or to delete a signature.
 */
export const signatureRevokeRoutes: FastifyPluginCallbackZod<SignatureRevokeRoutesOptions> = (app, options, done) => {
  const { db, enqueuer } = options;
  answerRuleErrors(app);
  app.post(
    SIGNATURE_REVOKE_PATH,
    {
      // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { response: { 200: signatureRevokeResponseSchema } },
      config: {
        access: tenantAccess({ mode: 'write', resolve: bySignatureParam(db) }),
        audit: 'signature.revoked',
      },
    },
    async (request, reply): Promise<SignatureRevokeResponse> => {
      const tenant = requireTenant(request);
      const body = parseInput(signatureRevokeRequestSchema, request.body);
      const { user } = requireAuth(request);
      const revoked = await revokeSignature({ db, enqueuer }, tenant, {
        signatureId: paramsOf(signatureParams, request).signatureId,
        reason: body.reasonCode,
        actor: { userId: user.id, githubId: user.githubId },
      });
      setNoStore(reply);
      return {
        signature: { id: revoked.id, state: 'revoked', revokedAt: revoked.revokedAt.toISOString() },
        reevaluating: revoked.reevaluating,
      };
    },
  );
  done();
};
