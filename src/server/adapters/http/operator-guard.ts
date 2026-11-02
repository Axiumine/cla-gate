// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyRequest } from 'fastify';
import { isOperator } from '../../domain/operator.ts';
import type { OperatorPolicies } from '../../services/operator-policies.ts';
import { requireAuth } from './auth-request.ts';
import { AppError } from './errors.ts';

// The guard of an `operator` route (E11-S08). The caller is known by now (`401` otherwise, from the guard of the route
// access); this decides, by the numeric GitHub id of the session and never by the login, whether the person operates the
// instance. Anyone else gets the `404 not_found` of a route that does not exist, so a person who is not the operator cannot
// tell the route from a typo. The operator role is no tenant role: nothing here sets `request.tenant`, and the guard of a
// tenant route (E11-S05) never reads the policy.

/**
 * Lets the operator through.
 * @throws AppError `404 not_found` for a signed-in person who is not an operator; the failure of the policy as it is when the
 * owner of the App could not be told (GitHub unavailable: `502`, E11-S04), which denies everyone and allows no one.
 */
export async function guardOperator(operators: OperatorPolicies, request: FastifyRequest): Promise<void> {
  const { user } = requireAuth(request);
  if (!isOperator(user.githubId, await operators.current())) {
    throw new AppError(404, 'not_found');
  }
}
