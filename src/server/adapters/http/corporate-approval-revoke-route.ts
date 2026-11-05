// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { approvalRevokeRequestSchema, approvalRevokeRoute } from '../../../shared/corporate-approvals.ts';
import { revokeApproval } from '../../services/corporate-approval-revoke.ts';
import { requireAuth } from './auth-request.ts';
import { presentRevoked } from './corporate-approval-presenters.ts';
import { approvalText, changing, type Deps, type Routes } from './corporate-approval-route-options.ts';
import { setNoStore } from './no-store.ts';
import { parseInput } from './request-body.ts';

/** `DELETE .../approvals/:approvalId`: revokes one approval, with the approvals derived from it. */
export function revokeRoute(app: Routes, deps: Deps): void {
  app.delete(
    approvalRevokeRoute.path,
    {
      ...changing('corporate_approval.revoked'),
      // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { response: approvalRevokeRoute.responses },
    },
    async (request, reply) => {
      const ids = parseInput(approvalText, request.params);
      // A revocation with no reason has no body at all; a body that is there is read like any other.
      const body = request.body === undefined ? {} : parseInput(approvalRevokeRequestSchema, request.body);
      const { user } = requireAuth(request);
      const revoked = await revokeApproval(
        { db: deps.db, enqueuer: deps.enqueuer },
        { userId: user.id, githubId: user.githubId },
        { ...ids, reason: body.reason },
      );
      setNoStore(reply);
      return presentRevoked(revoked);
    },
  );
}
