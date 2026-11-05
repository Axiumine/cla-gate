// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { COMMIT_OVERRIDE_PATH } from '../../../shared/commit-override.ts';
import { removeCommitOverride } from '../../services/commit-override-remove.ts';
import type { CommitOverrideRemovalDeps } from '../../services/commit-override-remove-request.ts';
import { requireAuth } from './auth-request.ts';
import { setNoStore } from './no-store.ts';
import { requireTenant, tenantAccess } from './tenant-access.ts';
import { byRepositoryParam, idText, paramsOf } from './tenant-resolvers.ts';

/** The instance the route is registered on: Fastify with the zod type provider. */
type Routes = Parameters<FastifyPluginCallbackZod>[0];

const overrideParams = z.object({ repositoryId: idText, overrideId: idText });

/**
 * `DELETE /api/repositories/:repositoryId/commit-overrides/:overrideId` (E15-S06): removes one override for good and answers `204`. A
 * `tenant` route in `write` mode, so a stranger gets the uniform `404`, a suspended tenant `409 installation_suspended`, and the role is
 * asked of GitHub again; the role is the one that records an override (the repository-action rule), judged again under the lock of the
 * repository's row. An override the repository does not have, another tenant's or another repository's included, and one that is gone
 * already are `404`. Audited as `commit_override.deleted`, in the transaction of the removal, which also sends the jobs that evaluate
 * the pull requests it had turned green again. A repository that is switched off can be cleaned of its overrides too.
 */
export function removeOverrideRoute(app: Routes, deps: CommitOverrideRemovalDeps): void {
  app.delete(
    COMMIT_OVERRIDE_PATH,
    {
      config: {
        access: tenantAccess({ mode: 'write', resolve: byRepositoryParam(deps.db) }),
        audit: 'commit_override.deleted',
      },
    },
    async (request, reply) => {
      const tenant = requireTenant(request);
      const { repositoryId, overrideId } = paramsOf(overrideParams, request);
      await removeCommitOverride(deps, tenant, {
        repositoryId,
        overrideId,
        role: tenant.role,
        actorGithubId: requireAuth(request).user.githubId,
      });
      setNoStore(reply);
      reply.statusCode = 204;
    },
  );
}
