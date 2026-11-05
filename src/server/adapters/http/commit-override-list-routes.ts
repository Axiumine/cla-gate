// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import { PAGE_SIZE, pageQuerySchema } from '../../../shared/cla.ts';
import {
  COMMIT_OVERRIDES_PATH,
  type CommitOverridePage,
  commitOverridePageSchema,
} from '../../../shared/commit-override.ts';
import { listCommitOverridePage } from '../../services/commit-override-list.ts';
import type { Database } from '../db/schema.ts';
import { overrideCursor, readOverrideCursor } from './commit-override-cursor.ts';
import { setNoStore } from './no-store.ts';
import { parseInput } from './request-body.ts';
import { requireTenant, tenantAccess } from './tenant-access.ts';
import { byRepositoryParam, repositoryIdOf } from './tenant-resolvers.ts';

/** The instance the route is registered on: Fastify with the zod type provider. */
type Routes = Parameters<FastifyPluginCallbackZod>[0];

/**
 * `GET /api/repositories/:repositoryId/commit-overrides` (E15-S06): the per-commit overrides of one repository, newest first, one page
 * at a time (`limit` 1 to 100, 50 by default, and the `cursor` of the page before). A `tenant` route in `read` mode (a role up to 60 s
 * old will do), so a stranger gets the uniform `404`; the role is the one that records an override (the repository-action rule on the
 * document the repository enforces: an org admin, or an admin of the repository when the document is its own). The reason and the login
 * are returned as stored, not escaped. The route reads only, so it writes no audit row; the answer is told not to be cached. The query is
 * read in the handler after the guard, so a stranger learns nothing of how it is read.
 */
export function listOverridesRoute(app: Routes, db: Kysely<Database>): void {
  app.get(
    COMMIT_OVERRIDES_PATH,
    {
      // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { response: { 200: commitOverridePageSchema } },
      config: { access: tenantAccess({ mode: 'read', resolve: byRepositoryParam(db) }) },
    },
    async (request, reply): Promise<CommitOverridePage> => {
      const tenant = requireTenant(request);
      const query = parseInput(pageQuerySchema, request.query);
      const page = await listCommitOverridePage(db, tenant, {
        repositoryId: repositoryIdOf(request),
        role: tenant.role,
        limit: query.limit ?? PAGE_SIZE.default,
        from: query.cursor === undefined ? null : readOverrideCursor(query.cursor),
      });
      setNoStore(reply);
      return {
        items: page.items.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })),
        nextCursor: page.next === null ? null : overrideCursor(page.next),
      };
    },
  );
}
