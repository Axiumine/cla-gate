// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import { CORPORATE_AGREEMENTS_CSV_PATH, CORPORATE_APPROVALS_CSV_PATH } from '../../../shared/corporate-export.ts';
import { type CorporateExportKind, openCorporateExport } from '../../services/export/corporate-export.ts';
import type { Clock } from '../../services/ports/clock.ts';
import type { Database } from '../db/schema.ts';
import { requireAuth } from './auth-request.ts';
import { setAttachment } from './csv-attachment.ts';
import { setNoStore } from './no-store.ts';
import { RATE_LIMITS, userRateLimit } from './rate-limit.ts';
import { parseInput } from './request-body.ts';
import { logReleaseFailure } from './signature-csv-log.ts';
import { requireTenant, tenantAccess } from './tenant-access.ts';
import { byInstallationParam } from './tenant-resolvers.ts';

/** The query string of both exports: they have none, so any parameter is a `400` and not one that is quietly ignored. */
const noQuery = z.strictObject({});

export interface CorporateExportRoutesOptions {
  readonly db: Kysely<Database>;
  /** Where the date in the file name comes from. */
  readonly clock: Clock;
}

/** The file name of an export: built from the kind and the date only, never from a name that a user wrote. */
function fileNameOf(kind: CorporateExportKind, clock: Clock): string {
  return `corporate-${kind}-${clock.now().toISOString().slice(0, 10)}.csv`;
}

/**
 * The corporate exports of a tenant (E21-S05), both `tenant` routes of org admins and both reads, so a suspended tenant is served. A person who
 * is not an org admin of the installation, and an installation that is not the caller's, get the uniform `404`.
 *
 * `GET /api/installations/:installationId/corporate-agreements.csv` is the agreements of the tenant, revoked ones included; and
 * `GET /api/installations/:installationId/approvals.csv` the approvals of all of them, in force, expired and revoked. Both are
 * written with the CSV writer of E16-S03, which puts a single quote in front of a cell that begins with `=`, `+`, `-`, `@`, a tab or a carriage
 * return, and both read one snapshot in batches, so a change that commits meanwhile cannot tear the file. Each person may ask six times a minute
 * for each file, the budget of the signature export. The file name is built from the kind and the date, never from a name that a user wrote.
 */
export const corporateExportRoutes: FastifyPluginCallbackZod<CorporateExportRoutesOptions> = (app, options, done) => {
  const { db, clock } = options;
  const route = (path: string, kind: CorporateExportKind): void => {
    app.get(
      path,
      {
        // A HEAD twin would have a budget of its own and double the person's.
        exposeHeadRoute: false,
        config: {
          access: tenantAccess({ mode: 'read', resolve: byInstallationParam(db) }),
          rateLimit: userRateLimit(RATE_LIMITS.signatureExport),
        },
      },
      async (request, reply) => {
        parseInput(noQuery, request.query);
        // nosemgrep: ajinabraham.njsscan.xss.xss_node.express_xss -- the answer is a text/csv attachment and never HTML, nosniff is set by helmet, and domain/csv.ts guards every cell (E21-S05)
        const file = await openCorporateExport(db, requireTenant(request), kind, {
          actor: requireAuth(request).user.githubId,
          onReleaseError: logReleaseFailure(request.log, 'corporate_export_release_failed'),
        });
        setNoStore(reply);
        setAttachment(reply, fileNameOf(kind, clock));
        // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write -- the answer is a text/csv attachment and never HTML, nosniff is set by helmet, and domain/csv.ts guards every cell (E21-S05)
        return reply.send(file);
      },
    );
  };
  route(CORPORATE_AGREEMENTS_CSV_PATH, 'agreements');
  route(CORPORATE_APPROVALS_CSV_PATH, 'approvals');
  done();
};
