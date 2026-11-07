// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { APPROVAL_PAGE_SIZE, approvalListRoute, approvalPageQuerySchema } from '../../../shared/corporate-approvals.ts';
import { listApprovals } from '../../services/corporate-approval-list.ts';
import { requireAuth } from './auth-request.ts';
import { presentApprovals } from './corporate-approval-presenters.ts';
import { agreementText, type Deps, type Routes } from './corporate-approval-route-options.ts';
import { readAgreementCursor } from './corporate-presenters.ts';
import { setNoStore } from './no-store.ts';
import { parseInput } from './request-body.ts';

/** `GET .../approvals`: one page of the approvals of the agreement, newest first. No budget of its own: it changes nothing. */
export function listRoute(app: Routes, deps: Deps): void {
  app.get(
    approvalListRoute.path,
    {
      // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { params: agreementText, response: approvalListRoute.responses },
      exposeHeadRoute: false,
      config: { access: 'authenticated' },
    },
    async (request, reply) => {
      const { user } = requireAuth(request);
      const query = parseInput(approvalPageQuerySchema, request.query);
      const page = await listApprovals(deps.db, user.id, {
        agreementId: request.params.agreementId,
        limit: query.limit ?? APPROVAL_PAGE_SIZE.default,
        from: query.cursor === undefined ? null : readAgreementCursor(query.cursor),
      });
      setNoStore(reply);
      return presentApprovals(page);
    },
  );
}
