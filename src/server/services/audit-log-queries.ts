// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Expression, type ExpressionBuilder, type Kysely, type SqlBool, sql } from 'kysely';
import type { z } from 'zod';
import type { AuditAction } from '../../shared/audit.ts';
import { auditLogItemSchema, type auditLogPageSchema } from '../../shared/audit-log.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { type AuditCursor, encodeAuditCursor } from '../domain/audit-cursor.ts';

// What the audit log viewer reads (E16-S02). Every statement names the installation of the scope, so a row of another
// tenant, or a row of no tenant (an instance-level action, whose installation is null), is never read. The table is
// written by services/audit.ts only; nothing here changes it.

/** One page asked for: the filters, the size of the page and where it starts. */
export interface AuditLogRequest {
  readonly action?: AuditAction | undefined;
  readonly actorGithubId?: number | undefined;
  readonly subjectType?: string | undefined;
  readonly subjectId?: number | undefined;
  /** Inclusive. */
  readonly from?: Date | undefined;
  /** Exclusive. */
  readonly to?: Date | undefined;
  /** How many rows the page holds at most. */
  readonly limit: number;
  /** The place after which the page starts: the `nextCursor` of the page before it. */
  readonly cursor?: AuditCursor | undefined;
}

export type AuditLogPage = z.infer<typeof auditLogPageSchema>;

/** The instant of a row as text, to the microsecond and in UTC, as the cursor holds it. */
const OCCURRED_AT_MICROS = sql<string>`to_char(occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/**
 * The rows after the cursor, in the order of the listing (newest first, the larger id first among equal instants). The
 * bound on the instant alone is redundant, and it is there so that the index on (installation, instant) starts at the
 * cursor instead of at the newest row.
 */
function afterCursor(eb: ExpressionBuilder<Database, 'audit_log'>, cursor: AuditCursor): Expression<SqlBool> {
  const at = sql<Date>`${cursor.occurredAt}::timestamptz`;
  return eb.and([
    eb('occurred_at', '<=', at),
    eb.or([eb('occurred_at', '<', at), eb.and([eb('occurred_at', '=', at), eb('id', '<', cursor.id)])]),
  ]);
}

/** The conditions the filters and the cursor of the request add to the tenant's own. */
function filterConditions(
  eb: ExpressionBuilder<Database, 'audit_log'>,
  request: AuditLogRequest,
): Expression<SqlBool>[] {
  const { action, actorGithubId, subjectType, subjectId, from, to, cursor } = request;
  return [
    ...(action === undefined ? [] : [eb('action', '=', action)]),
    ...(actorGithubId === undefined ? [] : [eb('actor_github_id', '=', actorGithubId)]),
    ...(subjectType === undefined ? [] : [eb('subject_type', '=', subjectType)]),
    ...(subjectId === undefined ? [] : [eb('subject_id', '=', subjectId)]),
    ...(from === undefined ? [] : [eb('occurred_at', '>=', from)]),
    ...(to === undefined ? [] : [eb('occurred_at', '<', to)]),
    ...(cursor === undefined ? [] : [afterCursor(eb, cursor)]),
  ];
}

/**
 * The statement behind {@link listAuditLog}: one more row than the page holds, so the caller can tell whether another
 * page follows.
 * @internal Exported for the plan test (Knip ignores `@internal` exports in production mode).
 */
export function auditLogRows(db: Kysely<Database>, scope: TenantScope, request: AuditLogRequest) {
  return db
    .selectFrom('audit_log')
    .select(['id', 'occurred_at', 'action', 'actor_github_id', 'subject_type', 'subject_id', 'metadata'])
    .select(OCCURRED_AT_MICROS.as('occurred_at_micros'))
    .where('installation_id', '=', scope.installationId)
    .where((eb) => eb.and(filterConditions(eb, request)))
    .orderBy('occurred_at', 'desc')
    .orderBy('id', 'desc')
    .limit(request.limit + 1);
}

/** The login of each person in `githubIds` as the `users` snapshot holds it now. A person it has no row for is missing. */
async function loginsOf(db: Kysely<Database>, githubIds: readonly number[]): Promise<Map<number, string>> {
  if (githubIds.length === 0) {
    return new Map();
  }
  const users = await db
    .selectFrom('users')
    .select(['github_id', 'login'])
    .where('github_id', 'in', githubIds)
    .execute();
  return new Map(users.map((user) => [user.github_id, user.login]));
}

type Row = Awaited<ReturnType<ReturnType<typeof auditLogRows>['execute']>>[number];

/** One row as the viewer shows it; the login is the snapshot of the moment, never read from the audit table. */
function toItem(row: Row, logins: ReadonlyMap<number, string>): z.infer<typeof auditLogItemSchema> {
  return auditLogItemSchema.parse({
    id: row.id,
    occurredAt: row.occurred_at.toISOString(),
    action: row.action,
    actor:
      row.actor_github_id === null
        ? null
        : { githubId: row.actor_github_id, login: logins.get(row.actor_github_id) ?? null },
    subject:
      row.subject_type === null || row.subject_id === null ? null : { type: row.subject_type, id: row.subject_id },
    metadata: row.metadata,
  });
}

/**
 * One page of the audit trail of the tenant, newest first (`occurred_at desc, id desc`). `nextCursor` is set when more
 * rows follow and names the place after the last row of the page.
 */
export async function listAuditLog(
  db: Kysely<Database>,
  scope: TenantScope,
  request: AuditLogRequest,
): Promise<AuditLogPage> {
  const rows = await auditLogRows(db, scope, request).execute();
  const page = rows.slice(0, request.limit);
  const last = page.at(-1);
  const actors = [...new Set(page.flatMap((row) => (row.actor_github_id === null ? [] : [row.actor_github_id])))];
  const logins = await loginsOf(db, actors);
  return {
    items: page.map((row) => toItem(row, logins)),
    nextCursor:
      rows.length > request.limit && last !== undefined
        ? encodeAuditCursor({ occurredAt: last.occurred_at_micros, id: last.id })
        : null,
  };
}
