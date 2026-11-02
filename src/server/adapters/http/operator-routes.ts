// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import type { z } from 'zod';
import { OPERATOR_INSTALLATIONS_PATH, operatorInstallationsResponseSchema } from '../../../shared/operator.ts';
import { tenantState } from '../../domain/tenant-state.ts';
import { listInstallationsForOperator } from '../../services/installation-operator.ts';
import type { Database } from '../db/schema.ts';

// The routes of the instance operator (E11-S08). Who may call them is decided by the guard of the `operator` access kind
// (operator-guard.ts); the operator role gives no access to any tenant.

export interface OperatorRoutesOptions {
  readonly db: Kysely<Database>;
}

const iso = (instant: Date | null): string | null => instant?.toISOString() ?? null;

/**
 * `GET /api/operator/installations`: the rows of `listInstallationsForOperator` (E05-S07) with the state of each tenant
 * (E11-S07). Read-only, and it carries no personal data. The answer is told not to be cached: it lists every organisation
 * the instance serves.
 */
export const operatorRoutes: FastifyPluginCallbackZod<OperatorRoutesOptions> = (app, options, done) => {
  app.get(
    OPERATOR_INSTALLATIONS_PATH,
    // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
    { schema: { response: { 200: operatorInstallationsResponseSchema } }, config: { access: 'operator' } },
    async (_request, reply): Promise<z.infer<typeof operatorInstallationsResponseSchema>> => {
      const installations = await listInstallationsForOperator(options.db);
      reply.header('cache-control', 'no-store');
      return {
        installations: installations.map((installation) => ({
          githubInstallationId: installation.githubInstallationId,
          accountId: installation.accountId,
          accountLogin: installation.accountLogin,
          accountType: installation.accountType,
          admissionStatus: installation.admissionStatus,
          admissionReason: installation.admissionReason,
          admissionDecidedAt: iso(installation.admissionDecidedAt),
          suspendedAt: iso(installation.suspendedAt),
          deletedAt: iso(installation.deletedAt),
          tenantState: tenantState(installation),
          repositories: installation.repositories,
        })),
      };
    },
  );
  done();
};
