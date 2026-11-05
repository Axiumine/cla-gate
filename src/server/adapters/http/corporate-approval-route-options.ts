// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import { approvalParamsSchema, approvalsParamsSchema } from '../../../shared/corporate-approvals.ts';
import type { CorporateGitHub } from '../../services/corporate-approval-lookup.ts';
import type { JobEnqueuer } from '../../services/ports/jobs.ts';
import type { Database } from '../db/schema.ts';
import { SIGN_BODY_LIMIT } from './limits.ts';
import { idText } from './query-values.ts';
import { RATE_LIMITS, userRateLimit } from './rate-limit.ts';

// What the routes of the approvals of a corporate agreement share (E21-S03): the options of the plugin, how the path is read, and the options
// of a route that changes the approvals.

export interface CorporateApprovalRoutesOptions {
  readonly db: Kysely<Database>;
  /** Where the logins of an approval are looked up (E21-S03): the GitHub client port, by numeric id. */
  readonly github: CorporateGitHub;
  /** Where the evaluations of the pull requests that rested on a revoked approval are sent (E21-S05). */
  readonly enqueuer: JobEnqueuer;
}

/** The instance a route is registered on: Fastify with the zod type provider. */
export type Routes = Parameters<FastifyPluginCallbackZod>[0];

/** What the routes work with: the database, the GitHub the logins are looked up on, and the queue. */
export type Deps = Pick<CorporateApprovalRoutesOptions, 'db' | 'github' | 'enqueuer'>;

/** The path as text: plain digits for a positive integer, then the same rule as the descriptor's. Anything else is a `400`. */
export const agreementText = z.object({ agreementId: idText.pipe(approvalsParamsSchema.shape.agreementId) });

export const approvalText = z.object({
  agreementId: idText.pipe(approvalParamsSchema.shape.agreementId),
  approvalId: idText.pipe(approvalParamsSchema.shape.approvalId),
});

/**
 * The options of a route that changes the approvals of an agreement: the signed-in person only, a body of at most 16 KiB, the audit action
 * the route writes, and a budget of 60 a minute for each person, counted after the guards and kept for each of the three routes.
 */
export function changing(audit: 'corporate_approval.added' | 'corporate_approval.revoked') {
  return {
    bodyLimit: SIGN_BODY_LIMIT,
    config: {
      access: 'authenticated',
      audit,
      rateLimit: userRateLimit(RATE_LIMITS.corporateApproval),
    },
  } as const;
}
