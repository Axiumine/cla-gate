// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { Role } from '../../domain/authz.ts';
import {
  type DocumentPlacement,
  findDocumentPlacement,
  findSignaturePlacement,
} from '../../services/document-placement.ts';
import { findAdmittedTenantRows, installationOfRepository } from '../../services/tenant-queries.ts';
import { type InstallationRowId, installationRowIdSchema } from '../db/installation-row-id.ts';
import type { Database } from '../db/schema.ts';
import { AppError } from './errors.ts';
import type { TenantResolver, TenantTarget } from './tenant-access.ts';

// The resolvers every tenant route can use (E11-S05). A path names its tenant by `:installationId` and its repository by
// `:repositoryId`; both are the surrogate keys of our own tables (`installations.id`, `repositories.id`), never GitHub's ids.
// A value that cannot be one is a 400; one that can be and names nothing the caller may know of resolves to null, which the
// guard answers with the uniform 404.

/** An id as a path carries it: plain digits, no sign, no leading zero, and within what a number holds exactly. */
export const idText = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .pipe(z.int().positive());

export const installationParams = z.object({ installationId: idText.pipe(installationRowIdSchema) });

const repositoryParams = z.object({
  repositoryId: idText,
  installationId: idText.pipe(installationRowIdSchema).optional(),
});

/** The parameters of the route as the schema reads them. @throws AppError 400 when one is not an id. */
export function paramsOf<T extends z.ZodType>(schema: T, request: FastifyRequest): z.infer<T> {
  const parsed = schema.safeParse(request.params);
  if (!parsed.success) {
    throw new AppError(400, 'bad_request');
  }
  return parsed.data;
}

/**
 * The resolver of a route under `/…/:installationId/…` that acts on the installation itself: the requirement is
 * `org_admin`, or `any_role` for the one call that every person with a role in the installation may make (the list of its
 * repositories, E14-S01). An unknown installation, and one the admission policy rejected, resolve to null.
 * @throws AppError 400 when `:installationId` is not a positive integer in plain digits.
 */
export function byInstallationParam(
  db: Kysely<Database>,
  requirement: 'org_admin' | 'any_role' = 'org_admin',
): TenantResolver {
  return async (request) => {
    const { installationId } = paramsOf(installationParams, request);
    const rows = await findAdmittedTenantRows(db, { installationId }, null);
    return rows === null ? null : { installationId, repositoryId: null, requirement };
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
 * before it): the requirement is `repo_admin`, which an org admin satisfies too, unless the route asks for `org_admin` (the
 * corporate CLA of a repository is the organisation's to choose, E21-S02). The repository is read with its
 * installation id, so a repository of another installation than the one in the path is null, as are an unknown
 * repository, a removed one and one of a rejected tenant. A route whose requirement follows the scope of the resource
 * (E14) writes its own resolver.
 * @throws AppError 400 when `:repositoryId` or `:installationId` is not a positive integer in plain digits.
 */
export function byRepositoryParam(db: Kysely<Database>, requirement: Role = 'repo_admin'): TenantResolver {
  return async (request) => {
    const params = paramsOf(repositoryParams, request);
    const installationId = await installationOf(db, params);
    if (installationId === null) {
      return null;
    }
    const rows = await findAdmittedTenantRows(db, { installationId }, params.repositoryId);
    return rows === null ? null : { installationId, repositoryId: params.repositoryId, requirement };
  };
}

const documentParams = z.object({ installationId: idText.pipe(installationRowIdSchema), documentId: idText });

const signatureParams = z.object({ installationId: idText.pipe(installationRowIdSchema), signatureId: idText });

/**
 * The target of a call about a document, about a signature of one, or about an allowlist entry (the role matrix of the security
 * notes, E11-S07, E14-S07): a document that covers the installation needs an org admin; one of a repository that is part of it
 * needs an admin of that repository (an org admin passes too); one of a repository that left the installation stays reachable for
 * an org admin only, because the permission of a person on it cannot be checked, so the call names no repository. Null when the
 * tenant has no such document or is not admitted, or when the repository it names is not readable (the guard reads it again).
 */
export async function documentTarget(
  db: Kysely<Database>,
  installationId: InstallationRowId,
  placement: DocumentPlacement | null,
): Promise<TenantTarget | null> {
  if (placement === null) {
    return null;
  }
  const target: TenantTarget =
    placement.kind === 'repository'
      ? { installationId, repositoryId: placement.repositoryId, requirement: 'repo_admin' }
      : { installationId, repositoryId: null, requirement: 'org_admin' };
  return (await findAdmittedTenantRows(db, { installationId }, target.repositoryId)) === null ? null : target;
}

/**
 * The resolver of a route about one document (`/…/:installationId/…/:documentId`): the requirement follows the scope of the
 * document (see {@link documentTarget}). The document is read with the installation id of the path, so another tenant's
 * document, an unknown one and one of a rejected tenant are null.
 * @throws AppError 400 when `:installationId` or `:documentId` is not a positive integer in plain digits.
 */
export function byDocumentParam(db: Kysely<Database>): TenantResolver {
  return async (request) => {
    const { installationId, documentId } = paramsOf(documentParams, request);
    return documentTarget(db, installationId, await findDocumentPlacement(db, { installationId }, documentId));
  };
}

/**
 * The resolver of a route about one signature (`/…/:installationId/…/:signatureId`): the requirement follows the scope of
 * the signature's document, as for {@link byDocumentParam}. A signature made under another tenant's document (a transferred
 * repository's, say) is not found under this installation.
 * @throws AppError 400 when `:installationId` or `:signatureId` is not a positive integer in plain digits.
 */
export function bySignatureParam(db: Kysely<Database>): TenantResolver {
  return async (request) => {
    const { installationId, signatureId } = paramsOf(signatureParams, request);
    return documentTarget(db, installationId, await findSignaturePlacement(db, { installationId }, signatureId));
  };
}

/** The `:documentId` of a route that has passed its guard. @throws AppError 400 when it is not a positive integer in plain digits. */
export function documentIdOf(request: FastifyRequest): number {
  return paramsOf(documentParams, request).documentId;
}

/** The `:repositoryId` of a route that has passed its guard. @throws AppError 400 when it is not a positive integer in plain digits. */
export function repositoryIdOf(request: FastifyRequest): number {
  return paramsOf(repositoryParams, request).repositoryId;
}
