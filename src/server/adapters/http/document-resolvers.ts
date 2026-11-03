// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import { createDocumentRequestSchema } from '../../../shared/cla.ts';
import { findAdmittedTenantRows } from '../../services/tenant-queries.ts';
import type { Database } from '../db/schema.ts';
import { parseInput } from './request-body.ts';
import type { TenantResolver } from './tenant-access.ts';
import { installationParams, paramsOf } from './tenant-resolvers.ts';

// The resolver of the one tenant route whose requirement depends on its body (E12-S01). The others are in tenant-resolvers.ts.

/**
 * The resolver of `POST /…/:installationId/documents` (E12-S01): the document covers the installation, or the repository the
 * validated body names. The requirement is `org_admin` without a repository and `repo_admin` on it with one, which an org
 * admin satisfies too. A repository of another installation, an unknown one and a removed one resolve to null, like an
 * unknown installation and one the admission policy rejected.
 * @throws AppError 400 when `:installationId` is not a positive integer in plain digits, or the body is not a new document.
 */
export function byInstallationParamAndBodyRepository(db: Kysely<Database>): TenantResolver {
  return async (request) => {
    const { installationId } = paramsOf(installationParams, request);
    const { repositoryId } = parseInput(createDocumentRequestSchema, request.body);
    const rows = await findAdmittedTenantRows(db, { installationId }, repositoryId ?? null);
    if (rows === null) {
      return null;
    }
    return repositoryId === undefined
      ? { installationId, repositoryId: null, requirement: 'org_admin' }
      : { installationId, repositoryId, requirement: 'repo_admin' };
  };
}
