// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect } from 'vitest';
import { errorResponseSchema } from '../../../../shared/errors.ts';
import { PENDING_PRS_PATH, pendingPrsPageSchema } from '../../../../shared/pending-prs.ts';
import { type DetailsSpec, detailsOf, shaOf } from '../../../domain/pending-details-fixture/test-support.ts';
import { type PersonName, tenantChecksums } from '../../db/tenant-fixture/test-support.ts';
import { type DocumentWorld, documentWorld } from '../document-fixture/test-support.ts';

// The world of the tests of the pending pull requests (E15-S07): the two tenants and five people of the cross-tenant matrix on the real
// app, with the plain and the scoped repository of each tenant switched on and enforcing the document that covers it (the
// installation-wide one for `org-N/repo`, its own for `org-N/scoped`), and a call of the list as one of the people. The world already
// stores finished evaluations that succeed or are still running for the pull requests 7 to 10 of each plain repository, which a list of
// failures must not show.

/** The path of the list of one installation. */
const pendingPathOf = (installationId: number): string =>
  PENDING_PRS_PATH.replace(':installationId', String(installationId));

/** The pending pull requests list as that person (nobody: no session); `query` is the query string with its `?`. */
function askPending(world: DocumentWorld, who: PersonName | null, installationId: number, query = '') {
  return world.ask(who, { method: 'GET', url: `${pendingPathOf(installationId)}${query}` });
}

/** The matrix world with `pending(who, installationId, query)` and both tenants' repositories on. */
export async function pendingWorld() {
  const world = await documentWorld();
  for (const tenant of [world.t1, world.t2]) {
    for (const [repositoryId, documentId] of [
      [tenant.plain.repositoryId, tenant.documentId],
      [tenant.scoped.repositoryId, tenant.scoped.documentId],
    ] as const) {
      await world.db
        .updateTable('repositories')
        .set({ enabled: true, cla_document_id: documentId })
        .where('id', '=', repositoryId)
        .execute();
    }
  }
  const pending = (who: PersonName | null, installationId: number, query = '') =>
    askPending(world, who, installationId, query);
  return { ...world, pending };
}

export type PendingWorld = Awaited<ReturnType<typeof pendingWorld>>;

/** The repository of a tenant a pull request is stored for. */
export interface PendingTarget {
  readonly installationId: number;
  readonly repositoryId: number;
}

/** What a test says of one row of `pr_evaluations`. */
export interface StoredEvaluation {
  readonly prNumber: number;
  /** The head SHA is this number as 40 hexadecimal digits; 1 when absent. */
  readonly head?: number;
  readonly result?: 'in_progress' | 'success' | 'failure' | 'cancelled';
  readonly state?: 'open' | 'closed';
  /** The details of the engine described by a spec, or the value stored as it is. */
  readonly details?: DetailsSpec | object;
  /** When the row was written, with up to six decimals: the database keeps the microseconds. */
  readonly updatedAt?: string;
  readonly checkRunId?: number;
}

/** Whether `details` is the description of a test and not a value to store as it is. */
const isSpec = (details: DetailsSpec | object): details is DetailsSpec => 'codes' in details;

/** The details a row is stored with: the description made into the details of the engine, the value as it is, or an unsigned person when there is none. */
function detailsOfRow(row: StoredEvaluation): object {
  if (row.details === undefined) {
    return detailsOf({ codes: ['unsigned_contributor'], actors: [{ githubId: 4000 + row.prNumber }] });
  }
  return isSpec(row.details) ? detailsOf(row.details) : row.details;
}

/** The columns of the row the description stands for. */
function valuesOf(target: PendingTarget, row: StoredEvaluation) {
  return {
    installation_id: target.installationId,
    repository_id: target.repositoryId,
    pr_number: row.prNumber,
    head_sha: shaOf(row.head ?? 1),
    result: row.result ?? 'failure',
    pr_state: row.state ?? 'open',
    details: JSON.stringify(detailsOfRow(row)),
    ...(row.updatedAt === undefined ? {} : { updated_at: sql<Date>`${row.updatedAt}::timestamptz` }),
    ...(row.checkRunId === undefined ? {} : { check_run_id: row.checkRunId }),
  };
}

/** Stores the evaluations for the repository `target`, past the routes, and answers their ids in the order of `rows`. */
export async function storeEvaluations(
  world: PendingWorld,
  target: PendingTarget,
  rows: readonly StoredEvaluation[],
): Promise<number[]> {
  const stored = await world.db
    .insertInto('pr_evaluations')
    .values(rows.map((row) => valuesOf(target, row)))
    .returning('id')
    .execute();
  return stored.map((row) => row.id);
}

/**
 * The checksums of the tenant tables but the ledger of org admins: the guard records the admins it sees (E11-S07), for every call of an
 * admin, whatever the route does.
 */
export async function checksumsWithoutLedger(db: PendingWorld['db']) {
  const all = await tenantChecksums(db);
  return Object.fromEntries(Object.entries(all).filter(([table]) => table !== 'installation_admin_seen'));
}

/** The body of a `200` answer, read with the shared schema so that a body of another shape fails here. */
export function pageOf(response: { statusCode: number; json: () => unknown }) {
  expect(response.statusCode).toBe(200);
  return pendingPrsPageSchema.parse(response.json());
}

/** The pairs `repository full name #number` a `200` answer lists, in the order of the page. */
export const namesOf = (response: { statusCode: number; json: () => unknown }): string[] =>
  pageOf(response).items.map((item) => `${item.repository.fullName}#${String(item.prNumber)}`);

/** The `error.code` of an error answer. */
export const errorCodeOf = (response: { json: () => unknown }): string =>
  errorResponseSchema.parse(response.json()).error.code;

/** The body of an error answer without its request id, which is the one thing that differs between two denials. */
export const withoutRequestId = (response: { body: string }): string =>
  response.body.replace(/"requestId":"[^"]*"/u, '');
