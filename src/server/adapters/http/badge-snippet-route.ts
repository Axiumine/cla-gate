// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import { BADGE_SNIPPET_PATH, badgeSnippetResponseSchema } from '../../../shared/public-verification.ts';
import { readBadgeSnippet } from '../../services/repository-badge-snippet.ts';
import type { Database } from '../db/schema.ts';
import { setNoStore } from './no-store.ts';
import { requireTenant, tenantAccess } from './tenant-access.ts';
import { byRepositoryParam, repositoryIdOf } from './tenant-resolvers.ts';

/** The instance the route is set on: Fastify with the zod type provider. */
type Routes = Parameters<FastifyPluginCallbackZod>[0];

export interface BadgeSnippetRouteOptions {
  readonly db: Kysely<Database>;
  /** `PUBLIC_BASE_URL`: the origin the badge and the sign page of the snippet are on. */
  readonly publicBaseUrl: string;
}

/**
 * `GET /api/installations/:installationId/repositories/:repositoryId/badge-snippet` (E22-S03): the Markdown and the HTML a maintainer
 * pastes into a README to show the project badge, built from `PUBLIC_BASE_URL` and the repository's GitHub id, linked to the sign
 * page of the repository. A `tenant` route in `read` mode keyed by the repository, under the guard and the role rule of the opt-in
 * (`PUT .../public-verification`, E22-S02): a stranger gets the uniform `404`, a role that is too low for the document the repository
 * enforces `403`, and while the opt-in is off `409 public_verification_disabled`. It makes no call to GitHub, writes nothing and is
 * `no-store`: it is an answer for one maintainer, and the opt-in can change at any time.
 * The caller registers it in the scope where `answerRuleErrors` is set.
 */
export function badgeSnippetRoute(app: Routes, options: BadgeSnippetRouteOptions): void {
  const { db, publicBaseUrl } = options;
  app.get(
    BADGE_SNIPPET_PATH,
    {
      // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { response: { 200: badgeSnippetResponseSchema } },
      config: { access: tenantAccess({ mode: 'read', resolve: byRepositoryParam(db) }) },
    },
    async (request, reply) => {
      const tenant = requireTenant(request);
      const snippet = await readBadgeSnippet(db, tenant, {
        repositoryId: repositoryIdOf(request),
        role: tenant.role,
        publicBaseUrl,
      });
      setNoStore(reply);
      return snippet;
    },
  );
}
