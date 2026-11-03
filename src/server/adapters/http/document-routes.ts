// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.ts';
import { answerRuleErrors } from './cla-rule-errors.ts';
import { listRoute, repositoryListRoute } from './document-collection-routes.ts';
import { createRoute } from './document-create-route.ts';
import { readRoute, renameRoute } from './document-item-routes.ts';

// The routes of the CLA documents of a tenant (E12-S01): create, list, read and rename. Who may call each is decided by the
// guard of its `tenant` access (E11-S05); the requirement follows the scope of the document (the role matrix of the security
// notes). Every answer is told not to be cached. The collection routes are in document-collection-routes.ts, those of one
// document in document-item-routes.ts; the rules a request can break are answered by cla-rule-errors.ts.

export interface DocumentRoutesOptions {
  readonly db: Kysely<Database>;
}

/**
 * The five routes of the documents of a tenant: create, list, list for a repository, read and rename. The two mutations
 * declare their audit action (E04-S09); the service appends the row in the transaction of the change. A rule the request
 * broke (`ClaRuleError`) is answered with its status by the error handler of this plugin.
 */
export const documentRoutes: FastifyPluginCallbackZod<DocumentRoutesOptions> = (app, options, done) => {
  const { db } = options;
  answerRuleErrors(app);
  createRoute(app, db);
  listRoute(app, db);
  repositoryListRoute(app, db);
  readRoute(app, db);
  renameRoute(app, db);
  done();
};
