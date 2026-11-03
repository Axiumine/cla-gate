// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { AuditAction } from '../../../shared/audit.ts';
import type { Database } from '../../adapters/db/schema.ts';

// Audit rows with the instant the test chooses (E16-S02). The writer of services/audit.ts stamps every row with the time of
// the insert, so the boundary and pagination tests insert directly: the table accepts an insert from any role, and only
// the tests of the viewer do it.

/** One audit row to insert. Everything but the instant and the tenant has a default. */
export interface AuditRowSpec {
  /** ISO 8601 in UTC, up to the microsecond the column holds: `2026-11-02T10:00:00.123456Z`. */
  readonly occurredAt: string;
  /** `installations.id`, or `null` for an instance-level action. */
  readonly installationId: number | null;
  /** Defaults to `repository.enabled`. */
  readonly action?: AuditAction;
  /** Defaults to the actor 1001, the publisher `seedTenant` stores for tenant 1. `null` for a system action. */
  readonly actor?: number | null;
  /** Defaults to none. */
  readonly subject?: { readonly type: string; readonly id: number } | null;
  /** Defaults to `{}`. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Inserts the rows in one statement and returns their ids in the order given. */
export async function insertAuditRows(db: Kysely<Database>, rows: readonly AuditRowSpec[]): Promise<number[]> {
  const inserted = await db
    .insertInto('audit_log')
    .values(
      rows.map((row) => ({
        occurred_at: sql<Date>`${row.occurredAt}::timestamptz`,
        installation_id: row.installationId,
        actor_github_id: row.actor === undefined ? 1001 : row.actor,
        action: row.action ?? 'repository.enabled',
        subject_type: row.subject?.type ?? null,
        subject_id: row.subject?.id ?? null,
        metadata: JSON.stringify(row.metadata ?? {}),
      })),
    )
    .returning('id')
    .execute();
  return inserted.map((row) => row.id);
}
