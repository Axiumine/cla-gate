// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { addRoute, carryOverCopyRoute } from './corporate-approval-add-routes.ts';
import { listRoute } from './corporate-approval-list-route.ts';
import { revokeRoute } from './corporate-approval-revoke-route.ts';
import type { CorporateApprovalRoutesOptions } from './corporate-approval-route-options.ts';
import { answerCorporateErrors } from './corporate-rule-errors.ts';

/**
 * The approvals of a corporate agreement (E21-S03): the CLA manager, who is the signatory of the agreement, decides who it covers. Authority
 * is being that person, so the person is the one of the session and the agreement is found among theirs: an agreement that is not the
 * caller's is a `404 not_found`, the very answer for an id that names nothing, whatever the route and whatever the body.
 *
 * `GET .../approvals` lists them, in force, expired and revoked, newest first, a page at a time (50, at most 200); it is served for a
 * revoked agreement and a suspended installation. `POST .../approvals` adds one by account, e-mail domain or organisation and answers
 * `201`; `DELETE .../approvals/:approvalId` revokes one, with the approvals derived from it; `POST .../approvals/carry-over` copies the
 * manager's approvals of an earlier major. The three that write are behind the session, `Origin` and CSRF checks of E10, audited in the
 * transaction of the change, limited to 60 a minute for each person, and refused with `409 agreement_revoked` or
 * `409 installation_suspended` when the agreement or its tenant cannot be changed. The path and the body of those three are read by
 * the handlers and not by route schemas (a schema is checked before the guards), so a request with no session or from another site
 * learns nothing of how its input is read. GitHub is asked before the
 * transaction opens, and when it fails nothing is written (`503 upstream_unavailable`).
 */
export const corporateApprovalRoutes: FastifyPluginCallbackZod<CorporateApprovalRoutesOptions> = (
  app,
  options,
  done,
) => {
  const deps = { db: options.db, github: options.github };
  answerCorporateErrors(app);
  listRoute(app, deps);
  addRoute(app, deps);
  revokeRoute(app, deps);
  carryOverCopyRoute(app, deps);
  done();
};
