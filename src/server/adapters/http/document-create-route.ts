// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import { createDocumentRequestSchema, DOCUMENTS_PATH, documentResponseSchema } from '../../../shared/cla.ts';
import { createDocument } from '../../services/cla-document-changes.ts';
import type { Database } from '../db/schema.ts';
import { requireAuth } from './auth-request.ts';
import { presentDocument } from './document-presenters.ts';
import { byInstallationParamAndBodyRepository } from './document-resolvers.ts';
import { setNoStore } from './no-store.ts';
import { parseInput } from './request-body.ts';
import { requireTenant, tenantAccess } from './tenant-access.ts';

// The route that creates a document (E12-S01). Its body is read here (`parseInput`), after the guard has decided from the
// body's `repositoryId` which role the caller needs (`byInstallationParamAndBodyRepository`).

/** The instance the route is registered on: Fastify with the zod type provider. */
type Routes = Parameters<FastifyPluginCallbackZod>[0];

/** `POST /api/installations/:installationId/documents`: audited as `cla_document.created`, in the transaction of the insert. */
export function createRoute(app: Routes, db: Kysely<Database>): void {
  app.post(
    DOCUMENTS_PATH,
    {
      schema: { response: { 201: documentResponseSchema } },
      config: {
        access: tenantAccess({ mode: 'write', resolve: byInstallationParamAndBodyRepository(db) }),
        audit: 'cla_document.created',
      },
    },
    async (request, reply) => {
      const tenant = requireTenant(request);
      const body = parseInput(createDocumentRequestSchema, request.body);
      const document = await createDocument(db, tenant, requireAuth(request).user.githubId, {
        name: body.name,
        kind: body.kind,
        repositoryId: tenant.repositoryId,
      });
      setNoStore(reply);
      reply.statusCode = 201;
      return { document: presentDocument(document) };
    },
  );
}
