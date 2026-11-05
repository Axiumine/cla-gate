// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Readable } from 'node:stream';
import type { ControlledTransaction } from 'kysely';
import type { Database } from '../../adapters/db/schema.ts';
import type { TenantScope } from '../../adapters/db/tenant-scope.ts';
import { csvSnapshotStream } from './csv-stream.ts';
import type { SignatureFilter } from './signature-filter.ts';
import { signatureBatch } from './signature-queries.ts';
import { csvRowOf, HEADER_ROW } from './signature-rows.ts';

// The file of the signature export as a stream (E16-S03): the header row and then one chunk per batch of 1,000 signatures,
// read by keyset on the id from the snapshot the caller opened (csv-stream.ts).

/**
 * How many signatures are read, encoded and handed to the response at a time: the most the export holds in memory.
 * @internal Exported for the batch tests (Knip ignores `@internal` exports in production mode).
 */
export const EXPORT_BATCH_SIZE = 1000;

/**
 * The CSV of the snapshot `trx` as a stream. The snapshot ends with the stream: committed when the file was read to the end,
 * rolled back when a batch failed or the reader went away, and `onReleaseError` hears of an end that failed. A batch that
 * fails destroys the stream with the error, so the response is cut short and never ends as if the file were whole.
 */
export function csvStream(
  trx: ControlledTransaction<Database>,
  scope: TenantScope,
  filter: SignatureFilter,
  onReleaseError: (error: unknown) => void,
): Readable {
  return csvSnapshotStream(
    trx,
    {
      header: HEADER_ROW,
      batchSize: EXPORT_BATCH_SIZE,
      read: (page) => signatureBatch(trx, scope, filter, page),
      idOf: (row) => row.signature_id,
      encode: csvRowOf,
    },
    onReleaseError,
  );
}
