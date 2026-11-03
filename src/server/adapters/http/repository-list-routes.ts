// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { PAGE_SIZE } from '../../../shared/cla.ts';
import {
  INSTALLATION_REPOSITORIES_PATH,
  repositoryListQuerySchema,
  repositoryPageSchema,
} from '../../../shared/installations.ts';
import { listRepositoryPage } from '../../services/repository-list.ts';
import { requireAuth } from './auth-request.ts';
import type { InstallationRoutesOptions } from './installation-routes.ts';
import { setNoStore } from './no-store.ts';
import { readRepositoryCursor, repositoryCursor } from './repository-cursor.ts';
import { parseInput } from './request-body.ts';
import { requireTenant, tenantAccess } from './tenant-access.ts';
import { byInstallationParam } from './tenant-resolvers.ts';

/**
 * The repositories of one installation that the signed-in person may see, one page at a time (E14-S01), read only and not
 * cached. A tenant route that any role in the installation passes (`any_role`), so a person with no role gets the uniform
 * `404`; an org admin is shown every repository, anyone else the ones GitHub confirms they administer.
 */
export const repositoryListRoutes: FastifyPluginCallbackZod<InstallationRoutesOptions> = (app, options, done) => {
  const { db, roles } = options;
  app.get(
    INSTALLATION_REPOSITORIES_PATH,
    {
      // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { response: { 200: repositoryPageSchema } },
      config: { access: tenantAccess({ mode: 'read', resolve: byInstallationParam(db, 'any_role') }) },
    },
    async (request, reply) => {
      const tenant = requireTenant(request);
      const { user } = requireAuth(request);
      const query = parseInput(repositoryListQuerySchema, request.query);
      const page = await listRepositoryPage(
        { db, lookup: roles.lookups.read.repoAdmin },
        tenant,
        { githubId: user.githubId, login: user.login },
        {
          limit: query.limit ?? PAGE_SIZE.default,
          from: query.cursor === undefined ? null : readRepositoryCursor(query.cursor),
          q: query.q ?? null,
          enabled: query.enabled ?? null,
        },
      );
      setNoStore(reply);
      return { items: page.items, nextCursor: page.next === null ? null : repositoryCursor(page.next) };
    },
  );
  done();
};
