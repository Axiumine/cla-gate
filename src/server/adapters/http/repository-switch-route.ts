// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyReply, FastifyRequest } from 'fastify';
import { repositoryEnableRequestSchema } from '../../../shared/repository-enabled.ts';
import type { SwitchRequest } from '../../services/repository-switch-types.ts';
import { requireAuth } from './auth-request.ts';
import { setNoStore } from './no-store.ts';
import { parseInput } from './request-body.ts';
import { requireTenant, type TenantContext } from './tenant-access.ts';
import { repositoryIdOf } from './tenant-resolvers.ts';

// What the two switches of enforcement have in common as routes (E14-S03, E14-S04): `POST /api/repositories/:repositoryId/enable`
// and `.../disable` take no body, answer `{ enabled, changed }` and differ in the service they call.

/**
 * Answers a switch request: the tenant the guard let the person into, the empty body checked (a key nobody defined is a `400`),
 * the service called with the repository, the role and the person's numeric GitHub id, and the answer marked `no-store`.
 * @throws what the body check and the service throw; the plugin's error handler answers a `ClaRuleError`.
 */
export async function answerSwitch<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  run: (tenant: TenantContext, switchRequest: SwitchRequest) => Promise<T>,
): Promise<T> {
  const tenant = requireTenant(request);
  parseInput(repositoryEnableRequestSchema, request.body);
  const answer = await run(tenant, {
    repositoryId: repositoryIdOf(request),
    role: tenant.role,
    actorGithubId: requireAuth(request).user.githubId,
  });
  setNoStore(reply);
  return answer;
}
