// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import { PAGE_SIZE, pageQuerySchema } from '../../../shared/cla.ts';
import {
  INSTALLATION_CORPORATE_AGREEMENTS_PATH,
  REPOSITORY_CORPORATE_DOCUMENT_PATH,
  repositoryCorporateDocumentRequestSchema,
  repositoryCorporateDocumentResponseSchema,
  tenantAgreementPageSchema,
} from '../../../shared/corporate.ts';
import { listTenantAgreements } from '../../services/corporate-agreements.ts';
import type { JobEnqueuer } from '../../services/ports/jobs.ts';
import { changeCorporateDocument } from '../../services/repository-corporate-document.ts';
import type { Database } from '../db/schema.ts';
import { requireAuth } from './auth-request.ts';
import { presentTenantAgreements, readAgreementCursor } from './corporate-presenters.ts';
import { answerCorporateErrors } from './corporate-rule-errors.ts';
import { setNoStore } from './no-store.ts';
import { parseInput } from './request-body.ts';
import { requireTenant, tenantAccess } from './tenant-access.ts';
import { byInstallationParam, byRepositoryParam, repositoryIdOf } from './tenant-resolvers.ts';

export interface CorporateTenantRoutesOptions {
  readonly db: Kysely<Database>;
  /** Where the sweep of a repository whose corporate CLA changed is sent. */
  readonly enqueuer: JobEnqueuer;
}

/**
 * The corporate routes of a tenant (E21-S02), both `tenant` routes of org admins.
 *
 * `PUT /api/installations/:installationId/repositories/:repositoryId/corporate-document` with `{ documentId }` chooses the corporate
 * CLA of a repository (a document of the corporate kind of the tenant that covers the installation or this repository), or removes
 * the choice with `null`. The requirement is `org_admin` and the call is a `write`, so the role is asked of GitHub again and a
 * suspended tenant is `409 installation_suspended`; a stranger gets the uniform `404`. A document the repository may not take is
 * `422 document_not_corporate`, whatever the reason. Audited as `repository.corporate_document_set` in the transaction of the change,
 * which also sends the sweep of the repository when it enforces the CLA, so its open pull requests are evaluated again.
 *
 * `GET /api/installations/:installationId/corporate-agreements` lists the agreements of the tenant, newest first, a page at a time:
 * the number of approvals in force and whether the agreement was revoked. It is a `read`, so a suspended tenant is served. Revoking an
 * agreement is the revocation of its signature (E15-S03) by the `signatureId` the list names.
 */
export const corporateTenantRoutes: FastifyPluginCallbackZod<CorporateTenantRoutesOptions> = (app, options, done) => {
  const { db, enqueuer } = options;
  answerCorporateErrors(app);
  app.put(
    REPOSITORY_CORPORATE_DOCUMENT_PATH,
    {
      // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { response: { 200: repositoryCorporateDocumentResponseSchema } },
      config: {
        access: tenantAccess({ mode: 'write', resolve: byRepositoryParam(db, 'org_admin') }),
        audit: 'repository.corporate_document_set',
      },
    },
    async (request, reply) => {
      const tenant = requireTenant(request);
      const body = parseInput(repositoryCorporateDocumentRequestSchema, request.body);
      const changed = await changeCorporateDocument({ db, enqueuer }, tenant, {
        repositoryId: repositoryIdOf(request),
        actorGithubId: requireAuth(request).user.githubId,
        documentId: body.documentId,
      });
      setNoStore(reply);
      return changed;
    },
  );
  app.get(
    INSTALLATION_CORPORATE_AGREEMENTS_PATH,
    {
      // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { response: { 200: tenantAgreementPageSchema } },
      config: { access: tenantAccess({ mode: 'read', resolve: byInstallationParam(db) }) },
    },
    async (request, reply) => {
      const tenant = requireTenant(request);
      const query = parseInput(pageQuerySchema, request.query);
      const page = await listTenantAgreements(db, tenant, {
        limit: query.limit ?? PAGE_SIZE.default,
        from: query.cursor === undefined ? null : readAgreementCursor(query.cursor),
      });
      setNoStore(reply);
      return presentTenantAgreements(page);
    },
  );
  done();
};
