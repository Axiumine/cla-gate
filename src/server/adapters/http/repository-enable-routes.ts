// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import { REPOSITORY_ENABLE_PATH, repositoryEnabledResponseSchema } from '../../../shared/repository-enabled.ts';
import type { JobEnqueuer } from '../../services/ports/jobs.ts';
import { enableRepository } from '../../services/repository-enablement.ts';
import type { Database } from '../db/schema.ts';
import { answerRuleErrors } from './cla-rule-errors.ts';
import { answerSwitch } from './repository-switch-route.ts';
import { tenantAccess } from './tenant-access.ts';
import { byRepositoryParam } from './tenant-resolvers.ts';

export interface RepositoryEnableRoutesOptions {
  readonly db: Kysely<Database>;
  /** Where the sweep of the pull requests that are already open is sent (E14-S03). */
  readonly enqueuer: JobEnqueuer;
}

/**
 * The route that turns enforcement on for a repository (E14-S03): `POST /api/repositories/:repositoryId/enable` with an empty
 * body. It is a `tenant` route keyed by the repository: the guard finds the installation from the repository, asks GitHub who the
 * person is in it (a `write`, so fresh) and lets in an admin of the repository or of the organisation; a stranger gets the
 * uniform `404`, a suspended tenant the `409 installation_suspended`. Which of the two the repository needs depends on the
 * document it enforces, which the service reads under the lock of the repository (the repository-action rule of E14-S01); a role
 * that is too low there is `403`. A repository with no published CLA is `409 no_active_cla`. Audited as `repository.enabled`, in
 * the transaction of the change, by `setRepositoryEnabled`. A rule the request broke (`ClaRuleError`) is answered with its status
 * by the error handler of this plugin. The route makes no call to GitHub: the sweep job it sends does.
 */
export const repositoryEnableRoutes: FastifyPluginCallbackZod<RepositoryEnableRoutesOptions> = (app, options, done) => {
  const { db, enqueuer } = options;
  answerRuleErrors(app);
  app.post(
    REPOSITORY_ENABLE_PATH,
    {
      // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { response: { 200: repositoryEnabledResponseSchema } },
      config: {
        access: tenantAccess({ mode: 'write', resolve: byRepositoryParam(db) }),
        audit: 'repository.enabled',
      },
    },
    (request, reply) =>
      answerSwitch(request, reply, (tenant, switching) => enableRepository(db, tenant, enqueuer, switching)),
  );
  done();
};
