// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import {
  ERASURE_PREVIEW_PATH,
  ERASURES_PATH,
  erasurePreviewSchema,
  erasureResultSchema,
} from '../../../shared/erasure.ts';
import { eraseSigner, erasureCounts } from '../../services/signer-erasure.ts';
import { holdsAnythingAbout } from '../../services/signer-erasure-counts.ts';
import type { Database } from '../db/schema.ts';
import { requireAuth } from './auth-request.ts';
import { asAppError, erasureRequest, previewQuerySchema } from './erasure-request.ts';
import { AppError } from './errors.ts';
import { setNoStore } from './no-store.ts';
import { requireTenant, tenantAccess } from './tenant-access.ts';
import { byInstallationParam } from './tenant-resolvers.ts';

export interface ErasureRoutesOptions {
  readonly db: Kysely<Database>;
}

/**
 * The two routes of the erasure of a signer's personal data (E16-S04), both for the org admin of the installation only: the
 * personal data of a person spans documents, so a repository admin gets a `403` and a viewer with no role the uniform `404`.
 * `GET …/erasure-preview?githubUserId=` counts what an erasure would remove; `POST …/erasures` removes it through the SQL
 * function `erase_signer_pii`, which writes the audit row `signer_pii.erased` itself. A person with no signature in the
 * installation and no allowlist entry there is a `404` on both, and an `expectedRows` that is no longer the number of rows
 * is a `409 count_changed` that changes nothing. The log line of an erasure holds numeric ids and counts only, never a name, a login or an email.
 */
export const erasureRoutes: FastifyPluginCallbackZod<ErasureRoutesOptions> = (app, options, done) => {
  app.get(
    ERASURE_PREVIEW_PATH,
    {
      // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { querystring: previewQuerySchema, response: { 200: erasurePreviewSchema } },
      config: { access: tenantAccess({ mode: 'read', resolve: byInstallationParam(options.db) }) },
    },
    async (request, reply) => {
      const { githubUserId } = request.query;
      const counts = await erasureCounts(options.db, requireTenant(request), githubUserId);
      if (!holdsAnythingAbout(counts)) {
        throw new AppError(404, 'not_found');
      }
      setNoStore(reply);
      return { githubUserId, ...counts };
    },
  );
  app.post(
    ERASURES_PATH,
    {
      // The body has no schema here: it is read by the handler, after the guards. The Origin, session and CSRF checks run in a
      // preHandler (E10-S03) and Fastify validates a body before that, so a body schema would answer a request with no Origin
      // (or no session) with a 400 and not with the 403 the check owes it.
      // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { response: { 200: erasureResultSchema } },
      config: {
        access: tenantAccess({ mode: 'write', resolve: byInstallationParam(options.db) }),
        audit: 'signer_pii.erased',
      },
    },
    async (request, reply) => {
      const { githubUserId, expectedRows } = erasureRequest(request.body);
      const tenant = requireTenant(request);
      const actor = requireAuth(request).user.githubId;
      const erasedRows = await eraseSigner(options.db, tenant, { githubUserId, expectedRows, actor }).catch(
        (error: unknown) => {
          throw asAppError(error);
        },
      );
      request.log.info(
        { installationId: tenant.installationId, githubUserId, actorGithubId: actor, expectedRows, erasedRows },
        'signer_erasure_done',
      );
      setNoStore(reply);
      return { erasedRows };
    },
  );
  done();
};
