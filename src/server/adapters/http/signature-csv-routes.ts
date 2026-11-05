// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import { SIGNATURES_CSV_PATH } from '../../../shared/signature-export.ts';
import { ExportChangedError, openSignatureExport } from '../../services/export/signature-export.ts';
import type { Clock } from '../../services/ports/clock.ts';
import type { Database } from '../db/schema.ts';
import { requireAuth } from './auth-request.ts';
import { setAttachment } from './csv-attachment.ts';
import { AppError } from './errors.ts';
import { setNoStore } from './no-store.ts';
import { idText } from './query-values.ts';
import { RATE_LIMITS, userRateLimit } from './rate-limit.ts';
import { logReleaseFailure } from './signature-csv-log.ts';
import { signatureCsvParamsSchema, signatureCsvQuerySchema } from './signature-csv-query.ts';
import { requireTenant, tenantAccess } from './tenant-access.ts';
import { byDocumentParam } from './tenant-resolvers.ts';

export interface SignatureCsvRoutesOptions {
  readonly db: Kysely<Database>;
  /** Where the date in the file name comes from. */
  readonly clock: Clock;
}

/**
 * `GET /api/installations/:installationId/documents/:documentId/signatures.csv` (E16-S03): the signatures of one document as
 * a CSV file. The role follows the scope of the document (an org admin for one that covers the installation, an admin of
 * the repository for one that belongs to it); a document of another tenant, an unknown one and a viewer with no role are the
 * same `404`. Each person may ask six times a minute. The audit row `signatures.exported` is committed before the first byte
 * is sent. The file name is built from the document id and the date, never from a name that a user wrote.
 */
export const signatureCsvRoutes: FastifyPluginCallbackZod<SignatureCsvRoutesOptions> = (app, options, done) => {
  app.get(
    SIGNATURES_CSV_PATH,
    {
      schema: { params: signatureCsvParamsSchema, querystring: signatureCsvQuerySchema },
      // A HEAD twin would have a budget of its own and double the person's.
      exposeHeadRoute: false,
      config: {
        access: tenantAccess({ mode: 'read', resolve: byDocumentParam(options.db) }),
        rateLimit: userRateLimit(RATE_LIMITS.signatureExport),
      },
    },
    async (request, reply) => {
      // nosemgrep: ajinabraham.njsscan.xss.xss_node.express_xss -- the answer is a text/csv attachment and never HTML, nosniff is set by helmet, and domain/csv.ts guards every cell (E16-S03)
      const documentId = idText.parse(request.params.documentId);
      const { state, from, to } = request.query;
      // nosemgrep: ajinabraham.njsscan.xss.xss_node.express_xss -- the answer is a text/csv attachment and never HTML, nosniff is set by helmet, and domain/csv.ts guards every cell (E16-S03)
      const signatures = await openSignatureExport(
        options.db,
        requireTenant(request),
        { documentId, state, from, to },
        {
          actor: requireAuth(request).user.githubId,
          onReleaseError: logReleaseFailure(request.log),
        },
      ).catch((error: unknown) => {
        throw error instanceof ExportChangedError ? new AppError(409, 'export_changed') : error;
      });
      setNoStore(reply);
      setAttachment(reply, `signatures-${documentId}-${options.clock.now().toISOString().slice(0, 10)}.csv`);
      // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write -- the answer is a text/csv attachment and never HTML, nosniff is set by helmet, and domain/csv.ts guards every cell (E16-S03)
      return reply.send(signatures.stream);
    },
  );
  done();
};
