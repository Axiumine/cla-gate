// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import {
  REPOSITORY_CLA_DOCUMENT_PATH,
  repositoryDocumentRequestSchema,
  repositoryDocumentResponseSchema,
} from '../../../shared/repository-document.ts';
import type { JobEnqueuer } from '../../services/ports/jobs.ts';
import { changeRepositoryDocument } from '../../services/repository-document-attach.ts';
import type { Database } from '../db/schema.ts';
import { requireAuth } from './auth-request.ts';
import { answerRuleErrors } from './cla-rule-errors.ts';
import { setNoStore } from './no-store.ts';
import { parseInput } from './request-body.ts';
import { requireTenant, tenantAccess } from './tenant-access.ts';
import { byRepositoryParam, repositoryIdOf } from './tenant-resolvers.ts';

export interface RepositoryDocumentRoutesOptions {
  readonly db: Kysely<Database>;
  /** Where the change of the CLA of an enforcing repository sends its sweep (E14-S02). */
  readonly enqueuer: JobEnqueuer;
}

/**
 * The route that chooses the CLA a repository enforces (E14-S02): `PUT /api/repositories/:repositoryId/cla-document` with
 * `{ documentId }`, a document to attach or `null` to detach. It is a `tenant` route keyed by the repository: the guard finds the
 * installation from the repository, asks GitHub who the person is in it (a `write`, so fresh) and lets in an admin of the
 * repository or of the organisation; a stranger gets the uniform `404`, a suspended tenant the `409`. Which of the two the
 * change itself needs depends on the documents it involves, which the service reads under the lock of the repository (see
 * `requiredRoleForDocumentChange`); a role that is too low there is the same `403`. Audited as `repository.cla_document_attached`
 * or `repository.cla_document_detached`, in the transaction of the change. A rule the request broke (`ClaRuleError`) is answered with
 * its status by the error handler of this plugin.
 */
export const repositoryDocumentRoutes: FastifyPluginCallbackZod<RepositoryDocumentRoutesOptions> = (
  app,
  options,
  done,
) => {
  const { db, enqueuer } = options;
  answerRuleErrors(app);
  app.put(
    REPOSITORY_CLA_DOCUMENT_PATH,
    {
      // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { response: { 200: repositoryDocumentResponseSchema } },
      config: {
        access: tenantAccess({ mode: 'write', resolve: byRepositoryParam(db) }),
        audit: 'repository.cla_document_attached',
      },
    },
    async (request, reply) => {
      const tenant = requireTenant(request);
      const body = parseInput(repositoryDocumentRequestSchema, request.body);
      const changed = await changeRepositoryDocument(db, tenant, enqueuer, {
        repositoryId: repositoryIdOf(request),
        role: tenant.role,
        actorGithubId: requireAuth(request).user.githubId,
        documentId: body.documentId,
      });
      setNoStore(reply);
      return changed;
    },
  );
  done();
};
