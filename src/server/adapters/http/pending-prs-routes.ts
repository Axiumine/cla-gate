// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { PAGE_SIZE } from '../../../shared/cla.ts';
import { PENDING_PRS_PATH, pendingPrsPageSchema } from '../../../shared/pending-prs.ts';
import { listPendingPrs } from '../../services/pending-prs.ts';
import { requireAuth } from './auth-request.ts';
import { AppError } from './errors.ts';
import type { InstallationRoutesOptions } from './installation-routes.ts';
import { setNoStore } from './no-store.ts';
import { readPendingCursor } from './pending-prs-cursor.ts';
import { presentPendingPage } from './pending-prs-presenter.ts';
import { pendingPrsQuerySchema } from './pending-prs-query.ts';
import { parseInput } from './request-body.ts';
import { requireTenant, tenantAccess } from './tenant-access.ts';
import { byInstallationParam } from './tenant-resolvers.ts';

/**
 * `GET /api/installations/:installationId/pending-prs` (E15-S07): the open pull requests of one tenant that `license/cla` blocks, with
 * the reasons and the people who must act. A tenant route that any role in the installation passes (`any_role`), so a person with no role
 * gets the uniform `404`; the repositories the person may read are then decided by the role: an org admin reads every enabled
 * repository, a repository admin the ones GitHub confirms they administer whose CLA document is their own. A `repositoryId` that is not in
 * the installation is the same `404`. The route reads only and asks GitHub nothing: it records no audit row, and the answer is told not to
 * be cached. The query is read in the handler after the guard, so a stranger learns nothing of how it is read.
 */
export const pendingPrsRoutes: FastifyPluginCallbackZod<InstallationRoutesOptions> = (app, options, done) => {
  const { db, roles } = options;
  app.get(
    PENDING_PRS_PATH,
    {
      // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { response: { 200: pendingPrsPageSchema } },
      config: { access: tenantAccess({ mode: 'read', resolve: byInstallationParam(db, 'any_role') }) },
    },
    async (request, reply) => {
      const tenant = requireTenant(request);
      const { user } = requireAuth(request);
      const query = parseInput(pendingPrsQuerySchema, request.query);
      const page = await listPendingPrs(
        { db, lookup: roles.lookups.read.repoAdmin },
        tenant,
        { githubId: user.githubId, login: user.login },
        {
          repositoryId: query.repositoryId ?? null,
          reason: query.reason ?? null,
          limit: query.limit ?? PAGE_SIZE.default,
          from: query.cursor === undefined ? null : readPendingCursor(query.cursor),
        },
      );
      if (page === null) {
        throw new AppError(404, 'not_found');
      }
      setNoStore(reply);
      return presentPendingPage(page);
    },
  );
  done();
};
