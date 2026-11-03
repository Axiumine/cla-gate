// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import { DOCUMENT_PATH, documentDetailResponseSchema, renameDocumentRequestSchema } from '../../../shared/cla.ts';
import { renameDocument } from '../../services/cla-document-changes.ts';
import { readDocument } from '../../services/cla-documents.ts';
import type { Database } from '../db/schema.ts';
import { requireAuth } from './auth-request.ts';
import { presentDetail } from './document-presenters.ts';
import { setNoStore } from './no-store.ts';
import { parseInput } from './request-body.ts';
import { requireTenant, tenantAccess } from './tenant-access.ts';
import { byDocumentParam, documentIdOf } from './tenant-resolvers.ts';

// The routes of one document of a tenant (E12-S01): read and rename. The requirement follows the scope of the document,
// which the resolver reads from the row (`byDocumentParam`).

/** The instance the routes are registered on: Fastify with the zod type provider. */
type Routes = Parameters<FastifyPluginCallbackZod>[0];

/** `GET .../documents/:documentId`: the document with its active version. */
export function readRoute(app: Routes, db: Kysely<Database>): void {
  app.get(
    DOCUMENT_PATH,
    {
      schema: { response: { 200: documentDetailResponseSchema } },
      config: { access: tenantAccess({ mode: 'read', resolve: byDocumentParam(db) }) },
    },
    async (request, reply) => {
      const document = await readDocument(db, requireTenant(request), documentIdOf(request));
      setNoStore(reply);
      return { document: presentDetail(document) };
    },
  );
}

/** `PATCH .../documents/:documentId`: audited as `cla_document.renamed`. */
export function renameRoute(app: Routes, db: Kysely<Database>): void {
  app.patch(
    DOCUMENT_PATH,
    {
      schema: { response: { 200: documentDetailResponseSchema } },
      config: {
        access: tenantAccess({ mode: 'write', resolve: byDocumentParam(db) }),
        audit: 'cla_document.renamed',
      },
    },
    async (request, reply) => {
      const body = parseInput(renameDocumentRequestSchema, request.body);
      const document = await renameDocument(db, requireTenant(request), requireAuth(request).user.githubId, {
        documentId: documentIdOf(request),
        name: body.name,
      });
      setNoStore(reply);
      return { document: presentDetail(document) };
    },
  );
}
