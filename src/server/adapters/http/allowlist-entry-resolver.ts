// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import { type FoundEntry, findAllowlistEntry } from '../../services/allowlist-entry-remove-queries.ts';
import type { DocumentPlacement } from '../../services/document-placement.ts';
import { installationRowIdSchema } from '../db/installation-row-id.ts';
import type { Database } from '../db/schema.ts';
import type { TenantResolver } from './tenant-access.ts';
import { documentTarget, idText, paramsOf } from './tenant-resolvers.ts';

// The resolver of the one tenant route that acts on a single allowlist entry (E14-S07). The others are in tenant-resolvers.ts.

const entryParams = z.object({ installationId: idText.pipe(installationRowIdSchema), entryId: idText });

/** Where the entry sits in its tenant, which decides the role a call about it needs. */
function placementOfEntry(entry: FoundEntry): DocumentPlacement {
  if (entry.repositoryId === null) {
    return { kind: 'installation' };
  }
  return entry.repositoryRemovedAt === null
    ? { kind: 'repository', repositoryId: entry.repositoryId }
    : { kind: 'removed_repository' };
}

/**
 * The resolver of a route about one allowlist entry (`/…/:installationId/allowlist-entries/:entryId`): the requirement follows the
 * scope of the entry, as for a document (the role matrix of the security notes): an entry that covers the installation needs an org
 * admin; one of a repository that is part of it, an admin of that repository (an org admin passes too); one of a repository that left
 * the installation stays reachable for an org admin only. The entry is read with the installation id of the path, so another
 * tenant's entry, an unknown one, a removed one and one of a rejected tenant are null.
 * @throws AppError 400 when `:installationId` or `:entryId` is not a positive integer in plain digits.
 */
export function byAllowlistEntryParam(db: Kysely<Database>): TenantResolver {
  return async (request) => {
    const { installationId, entryId } = paramsOf(entryParams, request);
    const entry = await findAllowlistEntry(db, { installationId }, entryId);
    return documentTarget(db, installationId, entry === undefined ? null : placementOfEntry(entry));
  };
}

/** The `:entryId` of a route that has passed its guard. @throws AppError 400 when it is not a positive integer in plain digits. */
export function entryIdOf(request: FastifyRequest): number {
  return paramsOf(entryParams, request).entryId;
}
