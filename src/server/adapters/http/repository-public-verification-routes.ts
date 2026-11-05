// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import {
  PUBLIC_VERIFICATION_PATH,
  publicVerificationRequestSchema,
  publicVerificationResponseSchema,
} from '../../../shared/public-verification.ts';
import { setPublicVerification } from '../../services/repository-public-verification.ts';
import type { Database } from '../db/schema.ts';
import { requireAuth } from './auth-request.ts';
import { badgeSnippetRoute } from './badge-snippet-route.ts';
import { answerRuleErrors } from './cla-rule-errors.ts';
import { setNoStore } from './no-store.ts';
import { parseInput } from './request-body.ts';
import { requireTenant, tenantAccess } from './tenant-access.ts';
import { byRepositoryParam, repositoryIdOf } from './tenant-resolvers.ts';

export interface RepositoryPublicVerificationRoutesOptions {
  readonly db: Kysely<Database>;
  /** `PUBLIC_BASE_URL`: the origin the badge snippet of E22-S03 is built on. */
  readonly publicBaseUrl: string;
}

/**
 * The route that turns the public signature check on or off for a repository (E22-S02):
 * `PUT /api/installations/:installationId/repositories/:repositoryId/public-verification` with `{ enabled }`. It is a `tenant` route
 * keyed by the repository, under the guard, the role rule and the error answers of the other settings of a repository (E14-S02,
 * E14-S03): the guard asks GitHub who the person is in the installation (a `write`, so fresh) and lets in an admin of the repository
 * or of the organisation, a stranger gets the uniform `404` (a repository of another installation than the one in the path
 * included), a suspended tenant the `409`; which of the two the change itself needs depends on the document the repository enforces,
 * which the service reads under the lock of the repository, and a role that is too low there is `403`. A call that asks for what
 * already is answers `changed: false` and writes nothing. Audited as `repository.public_verification_changed`, in the transaction
 * of the change. The route makes no call to GitHub and sends no job. The snippet of the README badge (E22-S03, `GET .../badge-snippet`)
 * is registered in the same scope, so it is answered with the same rule errors.
 */
export const repositoryPublicVerificationRoutes: FastifyPluginCallbackZod<RepositoryPublicVerificationRoutesOptions> = (
  app,
  options,
  done,
) => {
  const { db } = options;
  answerRuleErrors(app);
  app.put(
    PUBLIC_VERIFICATION_PATH,
    {
      // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { response: { 200: publicVerificationResponseSchema } },
      config: {
        access: tenantAccess({ mode: 'write', resolve: byRepositoryParam(db) }),
        audit: 'repository.public_verification_changed',
      },
    },
    async (request, reply) => {
      const tenant = requireTenant(request);
      const body = parseInput(publicVerificationRequestSchema, request.body);
      const changed = await setPublicVerification(db, tenant, {
        repositoryId: repositoryIdOf(request),
        role: tenant.role,
        actorGithubId: requireAuth(request).user.githubId,
        enabled: body.enabled,
      });
      setNoStore(reply);
      return changed;
    },
  );
  badgeSnippetRoute(app, options);
  done();
};
