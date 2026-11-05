// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { SIGNATURES_PATH, signatureSearchPageSchema } from '../../../shared/signature-search.ts';
import { searchSignatures } from '../../services/signature-search.ts';
import { requireAuth } from './auth-request.ts';
import { AppError } from './errors.ts';
import type { InstallationRoutesOptions } from './installation-routes.ts';
import { setNoStore } from './no-store.ts';
import { RATE_LIMITS, userRateLimit } from './rate-limit.ts';
import { parseInput } from './request-body.ts';
import { readSignatureCursor } from './signature-search-cursor.ts';
import { presentSignaturePage } from './signature-search-presenter.ts';
import { signatureSearchQuerySchema } from './signature-search-query.ts';
import { requireTenant, tenantAccess } from './tenant-access.ts';
import { byInstallationParam } from './tenant-resolvers.ts';

/**
 * `GET /api/installations/:installationId/signatures` (E15-S02): the signatures of one tenant a maintainer looks up before acting on
 * them, with the personal data the signer gave, which only a maintainer may see. A tenant route that any role in the installation
 * passes (`any_role`), so a person with no role gets the uniform `404`; the documents the person may read are then decided by
 * the scope of each document: an org admin reads every document, a repository admin the ones scoped to a repository they administer.
 * A `documentId` outside that set is the same `404`. The route reads only: it records no audit row (the export is the audited read,
 * E16-S03), and the answer is told not to be cached. Each person may ask thirty times a minute, counted after the guard, so the search
 * is not a way round the six a minute of the export. The query is read in the handler after the guard, so a stranger learns nothing
 * of how it is read.
 */
export const signatureSearchRoutes: FastifyPluginCallbackZod<InstallationRoutesOptions> = (app, options, done) => {
  const { db, roles } = options;
  app.get(
    SIGNATURES_PATH,
    {
      // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { response: { 200: signatureSearchPageSchema } },
      // A HEAD twin would have a budget of its own and double the person's.
      exposeHeadRoute: false,
      config: {
        access: tenantAccess({ mode: 'read', resolve: byInstallationParam(db, 'any_role') }),
        rateLimit: userRateLimit(RATE_LIMITS.signatureSearch),
      },
    },
    async (request, reply) => {
      const tenant = requireTenant(request);
      const { user } = requireAuth(request);
      const query = parseInput(signatureSearchQuerySchema, request.query);
      const page = await searchSignatures(
        { db, lookup: roles.lookups.read.repoAdmin },
        tenant,
        { githubId: user.githubId, login: user.login },
        {
          documentId: query.documentId ?? null,
          state: query.state,
          githubUserId: query.githubUserId ?? null,
          login: query.login ?? null,
          limit: query.limit,
          from: query.cursor === undefined ? null : readSignatureCursor(query.cursor),
        },
      );
      if (page === null) {
        throw new AppError(404, 'not_found');
      }
      setNoStore(reply);
      return presentSignaturePage(page);
    },
  );
  done();
};
