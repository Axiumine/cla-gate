// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import {
  COMMIT_OVERRIDES_PATH,
  type CommitOverrideResponse,
  commitOverrideRequestSchema,
  commitOverrideResponseSchema,
} from '../../../shared/commit-override.ts';
import { createCommitOverride } from '../../services/commit-override-create.ts';
import type { CommitGitHub } from '../../services/commit-override-lookup.ts';
import type { JobEnqueuer } from '../../services/ports/jobs.ts';
import type { Database } from '../db/schema.ts';
import { requireAuth } from './auth-request.ts';
import { answerRuleErrors } from './cla-rule-errors.ts';
import { setNoStore } from './no-store.ts';
import { parseInput } from './request-body.ts';
import { requireTenant, tenantAccess } from './tenant-access.ts';
import { byRepositoryParam, repositoryIdOf } from './tenant-resolvers.ts';

export interface CommitOverrideRoutesOptions {
  readonly db: Kysely<Database>;
  /** Where the commit is looked up (E15-S05); the route keeps nothing GitHub answers. */
  readonly github: CommitGitHub;
  /** Where the jobs that evaluate the failing pull requests of the repository again are sent. */
  readonly enqueuer: JobEnqueuer;
}

/**
 * Answers a record: the tenant the guard let the person into, the body read (after the guard, so a stranger learns nothing of how the
 * input is read), the service called, and the override sent back as `201`, marked `no-store`.
 * @throws what the body check and the service throw; the plugin's error handler answers a `ClaRuleError`.
 */
async function answerRecord(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: CommitOverrideRoutesOptions,
): Promise<CommitOverrideResponse> {
  const tenant = requireTenant(request);
  const { user } = requireAuth(request);
  const body = parseInput(commitOverrideRequestSchema, request.body);
  const recorded = await createCommitOverride(deps, tenant, {
    repositoryId: repositoryIdOf(request),
    role: tenant.role,
    actor: { id: user.id, githubId: user.githubId, login: user.login },
    commitSha: body.commitSha,
    reason: body.reason,
  });
  setNoStore(reply);
  reply.statusCode = 201;
  return {
    override: {
      id: recorded.id,
      repositoryId: recorded.repositoryId,
      commitSha: recorded.commitSha,
      reason: recorded.reason,
      createdBy: recorded.createdBy,
      createdAt: recorded.createdAt.toISOString(),
    },
  };
}

/**
 * `POST /api/repositories/:repositoryId/commit-overrides` (E15-S05) with `{ commitSha, reason }`: waives the check for the author and
 * committer of one commit whose email GitHub cannot link to an account. A `tenant` route in `write` mode, so a stranger gets the
 * uniform `404`, a suspended tenant `409 installation_suspended`, and the role is asked of GitHub again; the requirement is that of
 * every action on a repository: an org admin, or an admin of the repository when the document it enforces is its own. The body is
 * read in the handler after the guard; an abbreviated or otherwise unusable SHA is `422 invalid_commit_sha`, a reason that is empty
 * once trimmed or over 2,000 characters `422 invalid_reason`, a commit the repository does not have (GitHub's `404` or `422`)
 * `422 commit_not_found`, a repository that is off `409 repository_disabled`, and a commit overridden already `409 override_exists`.
 * GitHub failing is `502 github_unavailable` or `503 github_rate_limited` with `retry-after`. Audited as `commit_override.created`,
 * in the transaction of the record, which also sends the jobs. An override never implies a signature: nothing of `signatures` or
 * `signer_pii` is touched.
 */
export const commitOverrideRoutes: FastifyPluginCallbackZod<CommitOverrideRoutesOptions> = (app, options, done) => {
  answerRuleErrors(app);
  app.post(
    COMMIT_OVERRIDES_PATH,
    {
      // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { response: { 201: commitOverrideResponseSchema } },
      config: {
        access: tenantAccess({ mode: 'write', resolve: byRepositoryParam(options.db) }),
        audit: 'commit_override.created',
      },
    },
    (request, reply) => answerRecord(request, reply, options),
  );
  done();
};
