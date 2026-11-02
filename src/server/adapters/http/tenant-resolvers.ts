// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import { findAdmittedTenantRows, installationOfRepository } from '../../services/tenant-queries.ts';
import { type InstallationRowId, installationRowIdSchema } from '../db/installation-row-id.ts';
import type { Database } from '../db/schema.ts';
import { AppError } from './errors.ts';
import type { TenantResolver } from './tenant-access.ts';

// The resolvers every tenant route can use (E11-S05). A path names its tenant by `:installationId` and its repository by
// `:repositoryId`; both are the surrogate keys of our own tables (`installations.id`, `repositories.id`), never GitHub's ids.
// A value that cannot be one is a 400; one that can be and names nothing the caller may know of resolves to null, which the
// guard answers with the uniform 404.

/** An id as a path carries it: plain digits, no sign, no leading zero, and within what a number holds exactly. */
const idText = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .pipe(z.int().positive());

const installationParams = z.object({ installationId: idText.pipe(installationRowIdSchema) });

const repositoryParams = z.object({
  repositoryId: idText,
  installationId: idText.pipe(installationRowIdSchema).optional(),
});

/** The parameters of the route as the schema reads them. @throws AppError 400 when one is not an id. */
function paramsOf<T extends z.ZodType>(schema: T, request: FastifyRequest): z.infer<T> {
  const parsed = schema.safeParse(request.params);
  if (!parsed.success) {
    throw new AppError(400, 'bad_request');
  }
  return parsed.data;
}

/**
 * The resolver of a route under `/…/:installationId/…` that acts on the installation itself: the requirement is
 * `org_admin`. An unknown installation, and one the admission policy rejected, resolve to null.
 * @throws AppError 400 when `:installationId` is not a positive integer in plain digits.
 */
export function byInstallationParam(db: Kysely<Database>): TenantResolver {
  return async (request) => {
    const { installationId } = paramsOf(installationParams, request);
    const rows = await findAdmittedTenantRows(db, installationId, null);
    return rows === null ? null : { installationId, repositoryId: null, requirement: 'org_admin' };
  };
}

/** The installation of the repository the path names: the one in `:installationId` when the path has it, else the repository's own. */
async function installationOf(
  db: Kysely<Database>,
  params: { readonly repositoryId: number; readonly installationId?: InstallationRowId | undefined },
): Promise<InstallationRowId | null> {
  return params.installationId ?? (await installationOfRepository(db, params.repositoryId));
}

/**
 * The resolver of a route about one repository (`/…/repositories/:repositoryId/…`, with or without `:installationId`
 * before it): the requirement is `repo_admin`, which an org admin satisfies too. The repository is read with its
 * installation id, so a repository of another installation than the one in the path is null, as are an unknown
 * repository, a removed one and one of a rejected tenant. A route whose requirement follows the scope of the resource
 * (E14) writes its own resolver.
 * @throws AppError 400 when `:repositoryId` or `:installationId` is not a positive integer in plain digits.
 */
export function byRepositoryParam(db: Kysely<Database>): TenantResolver {
  return async (request) => {
    const params = paramsOf(repositoryParams, request);
    const installationId = await installationOf(db, params);
    if (installationId === null) {
      return null;
    }
    const rows = await findAdmittedTenantRows(db, installationId, params.repositoryId);
    return rows === null ? null : { installationId, repositoryId: params.repositoryId, requirement: 'repo_admin' };
  };
}
