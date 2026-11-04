// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import { REPOSITORY_DISABLE_PATH, repositoryEnabledResponseSchema } from '../../../shared/repository-enabled.ts';
import type { JobEnqueuer } from '../../services/ports/jobs.ts';
import { disableRepository } from '../../services/repository-disablement.ts';
import type { Database } from '../db/schema.ts';
import { answerRuleErrors } from './cla-rule-errors.ts';
import { answerSwitch } from './repository-switch-route.ts';
import { tenantAccess } from './tenant-access.ts';
import { byRepositoryParam } from './tenant-resolvers.ts';

export interface RepositoryDisableRoutesOptions {
  readonly db: Kysely<Database>;
  /** Where the job that completes the pending checks is sent (E14-S04). */
  readonly enqueuer: JobEnqueuer;
}

/**
 * The route that turns enforcement off for a repository (E14-S04): `POST /api/repositories/:repositoryId/disable` with an empty
 * body, under the same guard, role rule and error answers as the enable route (E14-S03): a stranger gets the uniform `404`, a
 * suspended tenant the `409 installation_suspended`, and a role too low for the document the repository enforces is `403`. A
 * repository that is off already answers `200 { enabled: false, changed: false }` and writes and sends nothing. Audited as
 * `repository.disabled`, in the transaction of the change, by `setRepositoryEnabled`; the same transaction sends the
 * `finalise-repository` job. The route makes no call to GitHub: the jobs it starts do.
 */
export const repositoryDisableRoutes: FastifyPluginCallbackZod<RepositoryDisableRoutesOptions> = (
  app,
  options,
  done,
) => {
  const { db, enqueuer } = options;
  answerRuleErrors(app);
  app.post(
    REPOSITORY_DISABLE_PATH,
    {
      // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { response: { 200: repositoryEnabledResponseSchema } },
      config: {
        access: tenantAccess({ mode: 'write', resolve: byRepositoryParam(db) }),
        audit: 'repository.disabled',
      },
    },
    (request, reply) =>
      answerSwitch(request, reply, (tenant, switching) => disableRepository(db, tenant, enqueuer, switching)),
  );
  done();
};
