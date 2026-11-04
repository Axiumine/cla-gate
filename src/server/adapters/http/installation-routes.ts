// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import { INSTALLATIONS_PATH, installationListSchema } from '../../../shared/installations.ts';
import { listAdministeredInstallations } from '../../services/installation-list.ts';
import type { TenantAuthorizationDeps } from '../../services/tenant-authorization.ts';
import type { Database } from '../db/schema.ts';
import { requireAuth } from './auth-request.ts';
import { setNoStore } from './no-store.ts';
import { parseInput } from './request-body.ts';

export interface InstallationRoutesOptions {
  readonly db: Kysely<Database>;
  /** The lookups the tenant guard decides with (E11-S05): the lists show the roles the guard enforces. */
  readonly roles: TenantAuthorizationDeps;
}

/** The query string of `GET /api/installations`: it has none, so any parameter is a `400` and not one that is quietly ignored. */
const noQuery = z.strictObject({});

/**
 * The route that tells a maintainer where they are one (E14-S01): the installations of the instance in which the signed-in
 * person holds a role, read only and not cached. It needs a session and nothing else, because it is the question "where am I
 * a maintainer"; the repositories of one installation are `repositoryListRoutes`.
 */
export const installationRoutes: FastifyPluginCallbackZod<InstallationRoutesOptions> = (app, options, done) => {
  const { db, roles } = options;
  app.get(
    INSTALLATIONS_PATH,
    {
      // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { response: { 200: installationListSchema } },
      config: { access: 'authenticated' },
    },
    async (request, reply) => {
      const { user } = requireAuth(request);
      parseInput(noQuery, request.query);
      const installations = await listAdministeredInstallations(
        { db, roles },
        { githubId: user.githubId, login: user.login },
      );
      setNoStore(reply);
      return installations;
    },
  );
  done();
};
