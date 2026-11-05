// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.ts';
import { corporateAgreementRoutes } from './corporate-agreement-routes.ts';
import { corporateSignRoutes } from './corporate-sign-routes.ts';
import { corporateTenantRoutes } from './corporate-tenant-routes.ts';

export interface CorporateRoutesOptions {
  readonly db: Kysely<Database>;
}

/**
 * All the routes of corporate signing (E21-S02), in the order the route tables of the tests spell out: the corporate CLA of a
 * repository and the signing, the agreements of the signed-in person, then the two routes of the org admins of a tenant.
 */
export const corporateRoutes: FastifyPluginCallbackZod<CorporateRoutesOptions> = (app, options, done) => {
  const { db } = options;
  app.register(corporateSignRoutes, { db });
  app.register(corporateAgreementRoutes, { db });
  app.register(corporateTenantRoutes, { db });
  done();
};
