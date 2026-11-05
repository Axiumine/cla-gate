// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Readable } from 'node:stream';
import type { ControlledTransaction, Kysely } from 'kysely';
import type { Database } from '../../adapters/db/schema.ts';
import type { TenantScope } from '../../adapters/db/tenant-scope.ts';
import {
  type AgreementExportRow,
  type ApprovalExportRow,
  agreementExportBatch,
  approvalExportBatch,
} from './corporate-export-queries.ts';
import { AGREEMENT_HEADER_ROW, APPROVAL_HEADER_ROW, agreementCsvRow, approvalCsvRow } from './corporate-export-rows.ts';
import { type CsvSource, csvSnapshotStream } from './csv-stream.ts';

// The exports of the corporate agreements and approvals of a tenant (E21-S05): the file as a stream, read in batches from one snapshot, so a signing,
// an approval or a revocation that commits meanwhile cannot tear it. Read only: it changes nothing and writes no audit row.

/**
 * How many rows are read, encoded and handed to the response at a time: the most an export holds in memory.
 * @internal Exported for the batch tests (Knip ignores `@internal` exports in production mode).
 */
export const CORPORATE_EXPORT_BATCH_SIZE = 1000;

/** Which file: the agreements of the tenant, or the approvals of all of them. */
export type CorporateExportKind = 'agreements' | 'approvals';

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

/**
 * Starts the export of `kind` for the tenant: one read-only `repeatable read` transaction is opened, so every batch of the file comes from the same
 * snapshot. It stays open until the stream ends or is destroyed: committed when the file was read to the end, rolled back otherwise, and
 * `onReleaseError` hears of an end that failed. The file holds the rows of the tenant of `scope` and of no other.
 */
export async function openCorporateExport(
  db: Kysely<Database>,
  scope: TenantScope,
  kind: CorporateExportKind,
  onReleaseError: (error: unknown) => void,
): Promise<Readable> {
  const trx = await db.startTransaction().setIsolationLevel('repeatable read').setAccessMode('read only').execute();
  return kind === 'agreements'
    ? csvSnapshotStream(trx, agreementSource(trx, scope), onReleaseError)
    : csvSnapshotStream(trx, approvalSource(trx, scope), onReleaseError);
}
