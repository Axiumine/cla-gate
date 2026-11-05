// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, type SqlBool, sql } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';

// The statement behind the list of the per-commit overrides of a repository (E15-S06). It names the installation and the repository, so
// an override of another tenant, one with an identical commit included, is never read. It writes nothing.

/**
 * A place in the list: the instant of an override and its id. The instant is kept at the microsecond precision the database stores
 * (`2026-10-15T09:00:00.123456Z`), because two overrides of one millisecond can be told apart only by it, and a cursor that rounded
 * it would skip or repeat them.
 */
export interface OverridePosition {
  readonly createdAt: string;
  readonly id: number;
}

/** One page asked for: how many overrides at most, and the place it starts at (`null` for the first page). */
export interface OverridePageRequest {
  readonly limit: number;
  readonly from: OverridePosition | null;
}

/** The instant of an override as text, to the microsecond and in UTC, as the cursor holds it. */
const CREATED_AT_MICROS = sql<string>`to_char(o.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as(
  'createdAtMicros',
);

/** The condition that keeps the overrides from `position` on, that one included, in the order `created_at desc, id desc`. */
const fromPosition = (position: OverridePosition) =>
  sql<SqlBool>`(o.created_at, o.id) <= (${position.createdAt}::timestamptz, ${position.id})`;

/**
 * The overrides of the repository `repositoryId` of the tenant, newest first (`created_at desc, id desc`), from `page.from` on (that one
 * included) and one more than the page holds: that row is where the next page starts, and without it there is none. Each comes with
 * the numeric GitHub id and the login the `users` row holds now for the person who recorded it (a display snapshot).
 */
export function listCommitOverrides(
  db: Kysely<Database>,
  scope: TenantScope,
  repositoryId: number,
  page: OverridePageRequest,
) {
  const { from } = page;
  const overrides = db
    .selectFrom('commit_overrides as o')
    .innerJoin('users as u', 'u.id', 'o.created_by')
    .select(['o.id', 'o.commit_sha', 'o.reason', 'o.created_at', 'u.github_id', 'u.login'])
    .select(CREATED_AT_MICROS)
    .where('o.installation_id', '=', scope.installationId)
    .where('o.repository_id', '=', repositoryId);
  return (from === null ? overrides : overrides.where(fromPosition(from)))
    .orderBy('o.created_at', 'desc')
    .orderBy('o.id', 'desc')
    .limit(page.limit + 1)
    .execute();
}

/** One row of {@link listCommitOverrides}. */
export type OverrideRow = Awaited<ReturnType<typeof listCommitOverrides>>[number];
