// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import { PAGE_SIZE, pageQuerySchema, VERSION_PATH, VERSIONS_PATH } from '../../../shared/cla.ts';
import { versionListResponseSchema, versionResponseSchema } from '../../../shared/cla-history.ts';
import { listVersionPage, readVersion } from '../../services/cla-history.ts';
import type { Database } from '../db/schema.ts';
import { setNoStore } from './no-store.ts';
import { parseInput } from './request-body.ts';
import { requireTenant, tenantAccess } from './tenant-access.ts';
import { byDocumentParam, documentIdOf } from './tenant-resolvers.ts';
import { versionIdOf } from './version-params.ts';
import { presentHistoryVersion, presentVersionText, readVersionCursor, versionCursor } from './version-presenters.ts';

// The routes that read the history of a document (E12-S05): the versions in the order of their numbers, and one version with its
// exact text. The requirement follows the scope of the document (`byDocumentParam`), like the draft and the publish, and the
// reads use the cached role. These are the only routes besides the publish (document-version-routes.ts) that hang on the
// versions of a document, and none accepts a change or a delete: a published version never changes (the route table test pins it).
// Every answer is told not to be cached.

/** The instance the routes are registered on: Fastify with the zod type provider. */
type Routes = Parameters<FastifyPluginCallbackZod>[0];

/** `GET .../documents/:documentId/versions`: the history, `major desc, minor desc`, one page at a time. */
export function listVersionsRoute(app: Routes, db: Kysely<Database>): void {
  app.get(
    VERSIONS_PATH,
    {
      schema: { response: { 200: versionListResponseSchema } },
      config: { access: tenantAccess({ mode: 'read', resolve: byDocumentParam(db) }) },
    },
    async (request, reply) => {
      const query = parseInput(pageQuerySchema, request.query);
      const from = query.cursor === undefined ? null : readVersionCursor(query.cursor);
      const page = await listVersionPage(db, requireTenant(request), documentIdOf(request), {
        limit: query.limit ?? PAGE_SIZE.default,
        from,
      });
      setNoStore(reply);
      return {
        versions: page.versions.map(presentHistoryVersion),
        nextCursor: page.next === null ? null : versionCursor(page.next),
      };
    },
  );
}

/**
 * `GET .../documents/:documentId/versions/:versionId`: the version with its canonical text. The text is checked against its
 * hash first; a mismatch is the plain `500` and a log line with ids (`cla_version_integrity_failed`).
 */
export function readVersionRoute(app: Routes, db: Kysely<Database>): void {
  app.get(
    VERSION_PATH,
    {
      schema: { response: { 200: versionResponseSchema } },
      config: { access: tenantAccess({ mode: 'read', resolve: byDocumentParam(db) }) },
    },
    async (request, reply) => {
      const version = await readVersion(
        db,
        requireTenant(request),
        { documentId: documentIdOf(request), versionId: versionIdOf(request) },
        { log: request.log },
      );
      setNoStore(reply);
      return { version: presentVersionText(version) };
    },
  );
}
