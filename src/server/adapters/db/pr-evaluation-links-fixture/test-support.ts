// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, PostgresQueryCompiler, type Selectable } from 'kysely';
import type { InstallationRowId } from '../installation-row-id.ts';
import { recordCheckRunId, recordCommentId } from '../pr-evaluation-links.ts';
import type { Database } from '../schema.ts';
import { twoTenants } from '../tenant-fixture/test-support.ts';
import type { TenantScope } from '../tenant-scope.ts';
import { migratedTestDatabase } from '../test-support.ts';

// The helpers of the tests of the reporting columns (E09-S04): evaluation rows with the values a test chooses, and a view of
// the statements a call sent.

/** A migrated database holding the two tenants of E11-S06, whose evaluation rows the tests of the reporting columns use. */
export async function linksWorld() {
  const { db } = await migratedTestDatabase();
  return { db, ...(await twoTenants(db)) };
}

/** A head SHA made of one hex digit. */
export const sha = (digit: string): string => digit.repeat(40);

/** The tenant a call acts for. */
export const scopeOf = (tenant: { readonly installationId: InstallationRowId }): TenantScope => ({
  installationId: tenant.installationId,
});

/** What a test chooses of a row; the rest is `success`, empty details and no ids. */
export interface EvaluationSpec {
  readonly prNumber: number;
  readonly headSha: string;
  readonly result?: Database['pr_evaluations']['result'];
  readonly checkRunId?: number;
  readonly commentId?: number;
  readonly updatedAt?: Date;
}

/** Stores an evaluation row of the repository of `tenant` and returns its id. */
export async function insertEvaluation(
  db: Kysely<Database>,
  tenant: { readonly installationId: InstallationRowId; readonly repositoryId: number },
  spec: EvaluationSpec,
): Promise<number> {
  const row = await db
    .insertInto('pr_evaluations')
    .values({
      installation_id: tenant.installationId,
      repository_id: tenant.repositoryId,
      pr_number: spec.prNumber,
      head_sha: spec.headSha,
      result: spec.result ?? 'success',
      details: JSON.stringify({ code: 'evaluation_failed' }),
      check_run_id: spec.checkRunId ?? null,
      comment_id: spec.commentId ?? null,
      ...(spec.updatedAt === undefined ? {} : { updated_at: spec.updatedAt }),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

export type StoredRow = Selectable<Database['pr_evaluations']>;

/** The two writes, each with the column it sets and the way to read that column: name, function, column, reader. */
export const WRITERS = [
  ['recordCheckRunId', recordCheckRunId, 'check_run_id', (row: StoredRow) => row.check_run_id],
  ['recordCommentId', recordCommentId, 'comment_id', (row: StoredRow) => row.comment_id],
] as const;

/** Every row of the table, in id order. */
export function readAllEvaluations(db: Kysely<Database>): Promise<StoredRow[]> {
  return db.selectFrom('pr_evaluations').selectAll().orderBy('id').execute();
}

/** A statement as the driver receives it. */
export interface SentStatement {
  readonly sql: string;
  readonly parameters: readonly unknown[];
}

/** `db` and the list that every statement sent through it is added to, compiled for Postgres. */
export function recording(db: Kysely<Database>): { readonly db: Kysely<Database>; readonly sent: SentStatement[] } {
  const sent: SentStatement[] = [];
  const compiler = new PostgresQueryCompiler();
  const traced = db.withPlugin({
    transformQuery: ({ node, queryId }) => {
      const compiled = compiler.compileQuery(node, queryId);
      sent.push({ sql: compiled.sql, parameters: compiled.parameters });
      return node;
    },
    transformResult: ({ result }) => Promise.resolve(result),
  });
  return { db: traced, sent };
}
