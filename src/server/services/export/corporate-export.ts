// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Readable } from 'node:stream';
import type { ControlledTransaction, Kysely } from 'kysely';
import type { GithubId } from '../../../shared/github-id.ts';
import type { Database } from '../../adapters/db/schema.ts';
import type { TenantScope } from '../../adapters/db/tenant-scope.ts';
import {
  type AgreementExportRow,
  type ApprovalExportRow,
  agreementExportBatch,
  approvalExportBatch,
} from './corporate-export-queries.ts';
import { type CorporateExportKind, recordCorporateExport } from './corporate-export-record.ts';
import { AGREEMENT_HEADER_ROW, APPROVAL_HEADER_ROW, agreementCsvRow, approvalCsvRow } from './corporate-export-rows.ts';
import { type CsvSource, csvSnapshotStream } from './csv-stream.ts';

// The exports of the corporate agreements and approvals of a tenant (E21-S05): the file as a stream, read in batches from one snapshot, so a signing,
// an approval or a revocation that commits meanwhile cannot tear it. The audit row that records the export is committed first (corporate-export-record.ts).

/**
 * How many rows are read, encoded and handed to the response at a time: the most an export holds in memory.
 * @internal Exported for the batch tests (Knip ignores `@internal` exports in production mode).
 */
export const CORPORATE_EXPORT_BATCH_SIZE = 1000;

export type { CorporateExportKind };

/** What the agreements file is made of, read in the snapshot `trx`. */
function agreementSource(trx: ControlledTransaction<Database>, scope: TenantScope): CsvSource<AgreementExportRow> {
  return {
    header: AGREEMENT_HEADER_ROW,
    batchSize: CORPORATE_EXPORT_BATCH_SIZE,
    read: (page) => agreementExportBatch(trx, scope, page),
    idOf: (row) => row.agreementId,
    encode: agreementCsvRow,
  };
}

/** What the approvals file is made of, read in the snapshot `trx`. */
function approvalSource(trx: ControlledTransaction<Database>, scope: TenantScope): CsvSource<ApprovalExportRow> {
  return {
    header: APPROVAL_HEADER_ROW,
    batchSize: CORPORATE_EXPORT_BATCH_SIZE,
    read: (page) => approvalExportBatch(trx, scope, page),
    idOf: (row) => row.approvalId,
    encode: approvalCsvRow,
  };
}

/** Who asks, and what to do when the end of the snapshot fails after the file was sent. */
export interface CorporateExportOptions {
  /** The numeric GitHub id of the person who exports: the actor of the audit row. */
  readonly actor: GithubId;
  /** Hears of a snapshot that could not be committed or rolled back. The response is done by then; the error is for the log. */
  readonly onReleaseError: (error: unknown) => void;
}

/**
 * Starts the export of `kind` for the tenant. The audit row `corporate_agreements.exported` or `corporate_approvals.exported` is committed
 * first; then one read-only `repeatable read` transaction is opened, so every batch of the file comes from the same snapshot. It stays open until the
 * stream ends or is destroyed: committed when the file was read to the end, rolled back otherwise, and `options.onReleaseError` hears of an end that
 * failed. The file holds the rows of the tenant of `scope` and of no other.
 */
export async function openCorporateExport(
  db: Kysely<Database>,
  scope: TenantScope,
  kind: CorporateExportKind,
  options: CorporateExportOptions,
): Promise<Readable> {
  await recordCorporateExport(db, scope, kind, options.actor);
  const trx = await db.startTransaction().setIsolationLevel('repeatable read').setAccessMode('read only').execute();
  return kind === 'agreements'
    ? csvSnapshotStream(trx, agreementSource(trx, scope), options.onReleaseError)
    : csvSnapshotStream(trx, approvalSource(trx, scope), options.onReleaseError);
}
