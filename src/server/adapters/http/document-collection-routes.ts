// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import {
  DOCUMENTS_PATH,
  documentListResponseSchema,
  PAGE_SIZE,
  pageQuerySchema,
  REPOSITORY_DOCUMENTS_PATH,
  repositoryDocumentsResponseSchema,
} from '../../../shared/cla.ts';
import { listDocumentPage, readRepositoryDocuments } from '../../services/cla-documents.ts';
import type { Database } from '../db/schema.ts';
import { presentPage } from './document-list-presenters.ts';
import { presentDocument, presentEntry, readPositionCursor } from './document-presenters.ts';
import { setNoStore } from './no-store.ts';
import { parseInput } from './request-body.ts';
import { requireTenant, tenantAccess } from './tenant-access.ts';
import { byInstallationParam, byRepositoryParam, repositoryIdOf } from './tenant-resolvers.ts';

// The routes of the documents of a tenant that work on the collection (E12-S01): the list of the installation and the list for a repository.
// A route reads its body and query itself (`parseInput`), after the guard of its `tenant` access (E11-S05).

/** The instance the routes are registered on: Fastify with the zod type provider. */
type Routes = Parameters<FastifyPluginCallbackZod>[0];

/** `GET` of the same path: the documents of the installation, one page at a time. */
export function listRoute(app: Routes, db: Kysely<Database>): void {
  app.get(
    DOCUMENTS_PATH,
    {
      schema: { response: { 200: documentListResponseSchema } },
      config: { access: tenantAccess({ mode: 'read', resolve: byInstallationParam(db) }) },
    },
    async (request, reply) => {
      const tenant = requireTenant(request);
      const query = parseInput(pageQuerySchema, request.query);
      const from = query.cursor === undefined ? null : readPositionCursor(query.cursor);
      const page = await listDocumentPage(db, tenant, { limit: query.limit ?? PAGE_SIZE.default, from });
      setNoStore(reply);
      return presentPage(page);
    },
  );
}

/** `GET .../repositories/:repositoryId/documents`: what a repository admin sees for the repository. */
export function repositoryListRoute(app: Routes, db: Kysely<Database>): void {
  app.get(
    REPOSITORY_DOCUMENTS_PATH,
    {
      schema: { response: { 200: repositoryDocumentsResponseSchema } },
      config: { access: tenantAccess({ mode: 'read', resolve: byRepositoryParam(db) }) },
    },
    async (request, reply) => {
      const tenant = requireTenant(request);
      const documents = await readRepositoryDocuments(db, tenant, repositoryIdOf(request));
      setNoStore(reply);
      return {
        repositoryScoped: documents.repositoryScoped.map(presentDocument),
        installationScoped: documents.installationScoped.map(presentEntry),
      };
    },
  );
}
