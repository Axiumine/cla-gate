// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import {
  approvalCreateRoute,
  approvalRequestSchema,
  carryOverRequestSchema,
  carryOverRoute,
} from '../../../shared/corporate-approvals.ts';
import { addApproval } from '../../services/corporate-approval-add.ts';
import { carryOverApprovals } from '../../services/corporate-approval-carry-over.ts';
import { requireAuth } from './auth-request.ts';
import { presentApproval } from './corporate-approval-presenters.ts';
import { agreementText, changing, type Deps, type Routes } from './corporate-approval-route-options.ts';
import { setNoStore } from './no-store.ts';
import { parseInput } from './request-body.ts';

/** `POST .../approvals`: adds one approval and answers `201` with it. */
export function addRoute(app: Routes, deps: Deps): void {
  app.post(
    approvalCreateRoute.path,
    {
      ...changing('corporate_approval.added'),
      // The path and the body have no schema here (see `corporateApprovalRoutes`). Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { response: approvalCreateRoute.responses },
    },
    async (request, reply) => {
      const { agreementId } = parseInput(agreementText, request.params);
      const body = parseInput(approvalRequestSchema, request.body);
      const { user } = requireAuth(request);
      const approval = await addApproval(
        deps,
        { userId: user.id, githubId: user.githubId },
        { agreementId, request: body },
      );
      setNoStore(reply);
      reply.statusCode = 201;
      return { approval: presentApproval(approval) };
    },
  );
}

/** `POST .../approvals/carry-over`: copies the manager's approvals of an earlier major and answers how many were copied and skipped. */
export function carryOverCopyRoute(app: Routes, deps: Deps): void {
  app.post(
    carryOverRoute.path,
    {
      ...changing('corporate_approval.added'),
      // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { response: carryOverRoute.responses },
    },
    async (request, reply) => {
      const { agreementId } = parseInput(agreementText, request.params);
      const body = parseInput(carryOverRequestSchema, request.body);
      const { user } = requireAuth(request);
      const result = await carryOverApprovals(
        deps.db,
        { userId: user.id, githubId: user.githubId },
        { agreementId, fromAgreementId: body.fromAgreementId },
      );
      setNoStore(reply);
      return result;
    },
  );
}
