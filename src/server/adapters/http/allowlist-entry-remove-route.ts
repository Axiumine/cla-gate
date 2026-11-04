// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { ALLOWLIST_ENTRY_PATH } from '../../../shared/allowlist.ts';
import { removeAllowlistEntry } from '../../services/allowlist-entry-remove.ts';
import type { AllowlistRemovalDeps } from '../../services/allowlist-entry-types.ts';
import { byAllowlistEntryParam, entryIdOf } from './allowlist-entry-resolver.ts';
import { requireAuth } from './auth-request.ts';
import { setNoStore } from './no-store.ts';
import { requireTenant, tenantAccess } from './tenant-access.ts';

/** The instance the route is registered on: Fastify with the zod type provider. */
type Routes = Parameters<FastifyPluginCallbackZod>[0];

/**
 * `DELETE /api/installations/:installationId/allowlist-entries/:entryId` (E14-S07): removes one entry for good and answers `204`.
 * A `tenant` route in `write` mode, so a stranger gets the uniform `404`, a suspended tenant `409 installation_suspended`, and the
 * role is asked of GitHub again. The requirement follows the scope of the entry (`byAllowlistEntryParam`): an org admin for one that
 * covers the installation, the repository-action rule for one of a repository, judged again under the lock of the repository's row.
 * An entry the tenant does not have, another tenant's included, and one that is gone already are `404`. Audited as
 * `allowlist_entry.deleted`, in the transaction of the removal, which also sends the sweeps.
 */
export function removeEntryRoute(app: Routes, deps: AllowlistRemovalDeps): void {
  app.delete(
    ALLOWLIST_ENTRY_PATH,
    {
      config: {
        access: tenantAccess({ mode: 'write', resolve: byAllowlistEntryParam(deps.db) }),
        audit: 'allowlist_entry.deleted',
      },
    },
    async (request, reply) => {
      const tenant = requireTenant(request);
      await removeAllowlistEntry(deps, tenant, {
        entryId: entryIdOf(request),
        role: tenant.role,
        actorGithubId: requireAuth(request).user.githubId,
      });
      setNoStore(reply);
      reply.statusCode = 204;
    },
  );
}
