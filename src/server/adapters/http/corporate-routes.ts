// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import type { CorporateGitHub } from '../../services/corporate-approval-lookup.ts';
import type { JobEnqueuer } from '../../services/ports/jobs.ts';
import type { Database } from '../db/schema.ts';
import { corporateAgreementRoutes } from './corporate-agreement-routes.ts';
import { corporateApprovalRoutes } from './corporate-approval-routes.ts';
import { corporateClaimRoutes } from './corporate-claim-routes.ts';
import { corporateSignRoutes } from './corporate-sign-routes.ts';
import { corporateTenantRoutes } from './corporate-tenant-routes.ts';

export interface CorporateRoutesOptions {
  readonly db: Kysely<Database>;
  /** Where the logins of an approval are looked up (E21-S03) and the membership of an employee is checked (E21-S04). */
  readonly github: CorporateGitHub;
  /** Where the evaluations of the pull requests of an employee who claimed coverage are sent (E21-S04). */
  readonly enqueuer: JobEnqueuer;
}

/**
 * All the routes of corporate signing (E21-S02), in the order the route tables of the tests spell out: the corporate CLA of a
 * repository and the signing, the agreements of the signed-in person, the approvals of an agreement (E21-S03), the claim of an employee
 * (E21-S04), then the two routes of the org admins of a tenant.
 */
export const corporateRoutes: FastifyPluginCallbackZod<CorporateRoutesOptions> = (app, options, done) => {
  const { db, github, enqueuer } = options;
  app.register(corporateSignRoutes, { db });
  app.register(corporateAgreementRoutes, { db });
  app.register(corporateApprovalRoutes, { db, github });
  app.register(corporateClaimRoutes, { db, github, enqueuer });
  app.register(corporateTenantRoutes, { db });
  done();
};
