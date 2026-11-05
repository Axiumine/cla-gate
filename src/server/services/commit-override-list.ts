// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import { type GithubId, parseGithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import type { Role } from '../domain/authz.ts';
import { judgedRepositoryRead } from './allowlist-entry-checks.ts';
import {
  listCommitOverrides,
  type OverridePageRequest,
  type OverridePosition,
  type OverrideRow,
} from './commit-override-list-queries.ts';

// The list of the per-commit overrides of a repository (E15-S06): read only. The statement is in commit-override-list-queries.ts; the
// role is judged here, by the rule that records and removes them (the repository-action rule on the document the repository enforces).

/** An override as the list tells it: the commit and the reason as stored, and the person who recorded it by numeric GitHub id. */
interface ListedOverride {
  readonly id: number;
  readonly commitSha: string;
  readonly reason: string;
  readonly createdBy: { readonly githubId: GithubId; readonly login: string };
  readonly createdAt: Date;
}

/** A page of overrides and where the next one starts (`null` on the last page). */
export interface OverridePage {
  readonly items: ListedOverride[];
  readonly next: OverridePosition | null;
}

/** The override a row of the statement stands for. */
function listed(row: OverrideRow): ListedOverride {
  return {
    id: row.id,
    commitSha: row.commit_sha,
    reason: row.reason,
    createdBy: { githubId: parseGithubId(row.github_id), login: row.login },
    createdAt: row.created_at,
  };
}

/**
 * A page of the overrides of the repository `request.repositoryId` of the tenant, newest first. The person needs the role the
 * repository-action rule asks for the document the repository enforces now (an org admin for none or the organisation's, an admin of
 * the repository for its own), the same as for recording and removing one. One override more than the page is read: it tells whether
 * more follow, and it is where the next page starts. A repository that is switched off is listed too.
 * @throws ClaRuleError `forbidden`, or `not_found` for a repository that left the tenant since the guard read it.
 */
export async function listCommitOverridePage(
  db: Kysely<Database>,
  scope: TenantScope,
  request: { readonly repositoryId: number; readonly role: Role } & OverridePageRequest,
): Promise<OverridePage> {
  await judgedRepositoryRead(db, scope, request);
  const rows = await listCommitOverrides(db, scope, request.repositoryId, request);
  const following = rows[request.limit];
  return {
    items: rows.slice(0, request.limit).map(listed),
    next: following === undefined ? null : { createdAt: following.createdAtMicros, id: following.id },
  };
}
