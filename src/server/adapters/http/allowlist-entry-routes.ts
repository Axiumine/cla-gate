// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import type { z } from 'zod';
import {
  allowlistEntryRequestSchema,
  allowlistEntryResponseSchema,
  INSTALLATION_ALLOWLIST_PATH,
  REPOSITORY_ALLOWLIST_PATH,
} from '../../../shared/allowlist.ts';
import type { AllowlistGitHub } from '../../services/allowlist-account.ts';
import { createAllowlistEntry } from '../../services/allowlist-entry-create.ts';
import type { AllowlistDeps, AllowlistEntry, AllowlistTarget } from '../../services/allowlist-entry-types.ts';
import type { JobEnqueuer } from '../../services/ports/jobs.ts';
import type { Database } from '../db/schema.ts';
import { allowlistListRoutes } from './allowlist-entry-list-routes.ts';
import { removeEntryRoute } from './allowlist-entry-remove-route.ts';
import { requireAuth } from './auth-request.ts';
import { answerRuleErrors } from './cla-rule-errors.ts';
import { setNoStore } from './no-store.ts';
import { parseInput } from './request-body.ts';
import { requireTenant, type TenantResolver, tenantAccess } from './tenant-access.ts';
import { byInstallationParam, byRepositoryParam, repositoryIdOf } from './tenant-resolvers.ts';

export interface AllowlistEntryRoutesOptions {
  readonly db: Kysely<Database>;
  /** Where an account is looked up (E14-S06); the routes never keep what GitHub answers beyond the numeric id and the login snapshot. */
  readonly github: AllowlistGitHub;
  /** Where the sweeps of the repositories the entry covers are sent. */
  readonly enqueuer: JobEnqueuer;
}

/** The instance the routes are registered on: Fastify with the zod type provider. */
type Routes = Parameters<FastifyPluginCallbackZod>[0];

/** The entry as the API tells it: times in ISO 8601 (UTC), the author by the numeric GitHub id. */
function present(entry: AllowlistEntry): z.infer<typeof allowlistEntryResponseSchema> {
  return {
    entry: {
      id: entry.id,
      scope: entry.scope,
      repositoryId: entry.repositoryId,
      kind: entry.kind,
      githubId: entry.githubId,
      loginSnapshot: entry.loginSnapshot,
      createdBy: { githubId: entry.createdBy },
      createdAt: entry.createdAt.toISOString(),
    },
  };
}

/**
 * Answers an add: the tenant the guard let the person into, the body read (after the guard, so a stranger learns nothing of how
 * the input is read), the service called, and the entry sent back as `201`, marked `no-store`.
 * @throws what the body check and the service throw; the plugin's error handler answers a `ClaRuleError`.
 */
async function answerAdd(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: AllowlistDeps,
  target: AllowlistTarget,
): Promise<z.infer<typeof allowlistEntryResponseSchema>> {
  const tenant = requireTenant(request);
  const entry = await createAllowlistEntry(deps, tenant, {
    target,
    role: tenant.role,
    actor: requireAuth(request).user,
    entry: parseInput(allowlistEntryRequestSchema, request.body),
  });
  setNoStore(reply);
  reply.statusCode = 201;
  return present(entry);
}

/** One of the two routes: `resolve` names the tenant, `targetOf` what the entry covers. */
function addRoute(
  app: Routes,
  path: string,
  route: { readonly resolve: TenantResolver; readonly targetOf: (request: FastifyRequest) => AllowlistTarget },
  deps: AllowlistDeps,
): void {
  app.post(
    path,
    {
      // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { response: { 201: allowlistEntryResponseSchema } },
      config: { access: tenantAccess({ mode: 'write', resolve: route.resolve }), audit: 'allowlist_entry.created' },
    },
    (request, reply) => answerAdd(request, reply, deps, route.targetOf(request)),
  );
}

/**
 * The routes of the allowlist. The adds (E14-S06) exempt an account: `POST /api/installations/:installationId/allowlist-entries` for the whole
 * installation (org admin) and `POST /api/repositories/:repositoryId/allowlist-entries` for one repository (the repository-action
 * rule of E14-S01: an org admin, or an admin of the repository when the document it enforces is its own). Both are `tenant` routes in
 * `write` mode, so a stranger gets the uniform `404`, a suspended tenant `409 installation_suspended`, and the role is asked of
 * GitHub again. The body is a union on `kind` (`user`, `bot`, `org_members`); a login is looked up on GitHub and stored by its
 * numeric id. Audited as `allowlist_entry.created`, in the transaction of the add, which also sends the sweeps. A rule the request
 * broke (`ClaRuleError`) is answered with its status by the error handler of this plugin; GitHub failing is `502 github_unavailable`
 * or `503 github_rate_limited` with `retry-after`. The same plugin registers the lists (E14-S07, allowlist-entry-list-routes.ts) and the
 * removal of an entry (allowlist-entry-remove-route.ts), which share its error handler.
 */
export const allowlistEntryRoutes: FastifyPluginCallbackZod<AllowlistEntryRoutesOptions> = (app, options, done) => {
  const { db, github, enqueuer } = options;
  const deps = { db, github, enqueuer };
  answerRuleErrors(app);
  addRoute(
    app,
    INSTALLATION_ALLOWLIST_PATH,
    { resolve: byInstallationParam(db), targetOf: () => ({ scope: 'installation' }) },
    deps,
  );
  addRoute(
    app,
    REPOSITORY_ALLOWLIST_PATH,
    {
      resolve: byRepositoryParam(db),
      targetOf: (request) => ({ scope: 'repository', repositoryId: repositoryIdOf(request) }),
    },
    deps,
  );
  allowlistListRoutes(app, db);
  removeEntryRoute(app, { db, enqueuer });
  done();
};
