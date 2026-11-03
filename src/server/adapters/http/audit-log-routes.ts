// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import type { z } from 'zod';
import { AUDIT_LOG_PATH, auditLogPageSchema } from '../../../shared/audit-log.ts';
import { listAuditLog } from '../../services/audit-log-queries.ts';
import type { Database } from '../db/schema.ts';
import { auditLogQuerySchema } from './audit-log-query.ts';
import { setNoStore } from './no-store.ts';
import { requireTenant, tenantAccess } from './tenant-access.ts';
import { byInstallationParam } from './tenant-resolvers.ts';

export interface AuditLogRoutesOptions {
  readonly db: Kysely<Database>;
}

/**
 * `GET /api/installations/:installationId/audit-log` (E16-S02): the audit trail of one tenant, filtered and paginated.
 * Only an org admin of the installation passes the guard (the account owner for a `User` installation): a viewer with no
 * role in it gets the uniform `404`, one with a lower role (a repository admin) a `403`. The route reads only; it records
 * no audit row of its own. The answer is told not to be cached.
 */
export const auditLogRoutes: FastifyPluginCallbackZod<AuditLogRoutesOptions> = (app, options, done) => {
  app.get(
    AUDIT_LOG_PATH,
    {
      // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { querystring: auditLogQuerySchema, response: { 200: auditLogPageSchema } },
      config: { access: tenantAccess({ mode: 'read', resolve: byInstallationParam(options.db) }) },
    },
    async (request, reply): Promise<z.infer<typeof auditLogPageSchema>> => {
      const page = await listAuditLog(options.db, requireTenant(request), request.query);
      setNoStore(reply);
      return page;
    },
  );
  done();
};
