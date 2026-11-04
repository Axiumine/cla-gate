// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import {
  ALLOWLIST_PAGE_SIZE,
  allowlistPageSchema,
  allowlistQuerySchema,
  INSTALLATION_ALLOWLIST_PATH,
  REPOSITORY_ALLOWLIST_PATH,
  repositoryAllowlistPageSchema,
} from '../../../shared/allowlist.ts';
import { listInstallationAllowlist, listRepositoryAllowlist } from '../../services/allowlist-entry-list.ts';
import type { Database } from '../db/schema.ts';
import {
  entryCursor,
  readEntryCursor,
  readRepositoryEntryCursor,
  repositoryEntryCursor,
} from './allowlist-entry-cursor.ts';
import { presentListedEntry } from './allowlist-entry-presenters.ts';
import { setNoStore } from './no-store.ts';
import { parseInput } from './request-body.ts';
import { requireTenant, tenantAccess } from './tenant-access.ts';
import { byInstallationParam, byRepositoryParam, repositoryIdOf } from './tenant-resolvers.ts';

// The routes that read the allowlist (E14-S07): the entries of an installation, and for a repository its own and the ones it inherits.
// Both are `tenant` routes in `read` mode (a role up to 60 s old will do) and every answer is told not to be cached. The query is read
// in the handler with `parseInput` after the guard, so a stranger learns nothing of how it is read.

/** The instance the routes are registered on: Fastify with the zod type provider. */
type Routes = Parameters<FastifyPluginCallbackZod>[0];

/**
 * `GET /api/installations/:installationId/allowlist-entries`: the entries that cover the whole installation, one page at a time
 * (`limit` 1 to 200, 100 by default, and the `cursor` of the page before). An org admin only.
 */
function listInstallationRoute(app: Routes, db: Kysely<Database>): void {
  app.get(
    INSTALLATION_ALLOWLIST_PATH,
    {
      // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { response: { 200: allowlistPageSchema } },
      config: { access: tenantAccess({ mode: 'read', resolve: byInstallationParam(db) }) },
    },
    async (request, reply) => {
      const tenant = requireTenant(request);
      const query = parseInput(allowlistQuerySchema, request.query);
      const page = await listInstallationAllowlist(db, tenant, {
        role: tenant.role,
        limit: query.limit ?? ALLOWLIST_PAGE_SIZE.default,
        from: query.cursor === undefined ? null : readEntryCursor(query.cursor),
      });
      setNoStore(reply);
      return {
        entries: page.entries.map((entry) => presentListedEntry(entry, false)),
        nextCursor: page.next === null ? null : entryCursor(page.next),
      };
    },
  );
}

/**
 * `GET /api/repositories/:repositoryId/allowlist-entries`: the entries of the repository (`own`) and those of the installation
 * (`inherited`, flagged `readOnly`), one page at a time: a page holds at most `limit` entries in all, `own` before `inherited`.
 * The role is what the repository-action rule asks for the document the repository enforces, so the admin of a repository whose
 * document is the organisation's is told `403`.
 */
function listRepositoryRoute(app: Routes, db: Kysely<Database>): void {
  app.get(
    REPOSITORY_ALLOWLIST_PATH,
    {
      // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { response: { 200: repositoryAllowlistPageSchema } },
      config: { access: tenantAccess({ mode: 'read', resolve: byRepositoryParam(db) }) },
    },
    async (request, reply) => {
      const tenant = requireTenant(request);
      const query = parseInput(allowlistQuerySchema, request.query);
      const page = await listRepositoryAllowlist(db, tenant, {
        repositoryId: repositoryIdOf(request),
        role: tenant.role,
        limit: query.limit ?? ALLOWLIST_PAGE_SIZE.default,
        from: query.cursor === undefined ? null : readRepositoryEntryCursor(query.cursor),
      });
      setNoStore(reply);
      return {
        own: page.own.map((entry) => presentListedEntry(entry, false)),
        inherited: page.inherited.map((entry) => presentListedEntry(entry, true)),
        nextCursor: page.next === null ? null : repositoryEntryCursor(page.next),
      };
    },
  );
}

/** Registers the two lists of the allowlist on `app`. */
export function allowlistListRoutes(app: Routes, db: Kysely<Database>): void {
  listInstallationRoute(app, db);
  listRepositoryRoute(app, db);
}
