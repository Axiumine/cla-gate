// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import { VERSIONS_PATH } from '../../../shared/cla.ts';
import { publishVersionRequestSchema, publishVersionResponseSchema } from '../../../shared/cla-version.ts';
import { publishVersion } from '../../services/cla-publish.ts';
import type { JobEnqueuer } from '../../services/ports/jobs.ts';
import type { Database } from '../db/schema.ts';
import { requireAuth } from './auth-request.ts';
import { presentPublished } from './document-presenters.ts';
import { CLA_BODY_LIMIT } from './limits.ts';
import { setNoStore } from './no-store.ts';
import { parseInput } from './request-body.ts';
import { requireTenant, tenantAccess } from './tenant-access.ts';
import { byDocumentParam, documentIdOf } from './tenant-resolvers.ts';

// The route that publishes a version of a document (E12-S04). The requirement follows the scope of the document
// (`byDocumentParam`), like the draft the version is made from. The version is the only thing it creates, and no route
// accepts a change or a delete of one: published versions are immutable (E12-S05 pins the route table).

/** The instance the route is registered on: Fastify with the zod type provider. */
type Routes = Parameters<FastifyPluginCallbackZod>[0];

/**
 * `POST .../documents/:documentId/versions`: audited as `cla_version.published`, in the transaction of the publish. The jobs a
 * major version asks for are sent by `enqueuer` in that transaction too; a send that fails fails the publish.
 */
export function publishRoute(app: Routes, db: Kysely<Database>, enqueuer: JobEnqueuer): void {
  app.post(
    VERSIONS_PATH,
    {
      bodyLimit: CLA_BODY_LIMIT,
      schema: { response: { 201: publishVersionResponseSchema } },
      config: {
        access: tenantAccess({ mode: 'write', resolve: byDocumentParam(db) }),
        audit: 'cla_version.published',
      },
    },
    async (request, reply) => {
      const body = parseInput(publishVersionRequestSchema, request.body);
      const published = await publishVersion(db, requireTenant(request), enqueuer, {
        actor: requireAuth(request).user,
        documentId: documentIdOf(request),
        source: body.source,
        bump: body.bump,
        rationale: body.rationale,
        expectedActiveVersionId: body.expectedActiveVersionId,
        acknowledgeResigning: body.acknowledgeResigning === true,
      });
      setNoStore(reply);
      reply.statusCode = 201;
      return presentPublished(published);
    },
  );
}
