// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { Readable } from 'node:stream';
import type { ControlledTransaction } from 'kysely';
import type { Database } from '../../adapters/db/schema.ts';

// The file of an export as a stream (E16-S03, E21-S05): the header row and then one chunk per batch, read by keyset on the id from the
// snapshot the caller opened. The signature export and the two exports of the corporate agreements read and encode differently and share this.

/** What one export is made of: its header row, how a batch is read, how a row is encoded and how long a batch is. */
export interface CsvSource<Row> {
  /** The header row, encoded, with its line end. */
  readonly header: string;
  /** How many rows are read, encoded and handed to the response at a time: the most the export holds in memory. */
  readonly batchSize: number;
  /** The rows with an id above `afterId`, in the order of the id, at most `limit` of them. */
  readonly read: (page: { readonly afterId: number; readonly limit: number }) => Promise<Row[]>;
  /** The key a batch continues from. */
  readonly idOf: (row: Row) => number;
  /** One row as a line, line end included. */
  readonly encode: (row: Row) => string;
}

/** The file, one chunk for the header and one per batch. Reaching the end marks the snapshot as read completely. */
async function* chunks<Row>(source: CsvSource<Row>, done: () => void): AsyncGenerator<string> {
  yield source.header;
  let afterId = 0;
  for (;;) {
    const rows = await source.read({ afterId, limit: source.batchSize });
    if (rows.length > 0) {
      yield rows.map(source.encode).join('');
    }
    const last = rows.at(-1);
    afterId = last === undefined ? afterId : source.idOf(last);
    if (rows.length < source.batchSize) {
      break;
    }
  }
  done();
}

/**
 * The CSV of `source` as a stream, read in the snapshot `trx`. The snapshot ends with the stream: committed when the file was read to the end,
 * rolled back when a batch failed or the reader went away, and `onReleaseError` hears of an end that failed. A batch that fails destroys the
 * stream with the error, so the response is cut short and never ends as if the file were whole.
 */
export function csvSnapshotStream<Row>(
  trx: ControlledTransaction<Database>,
  source: CsvSource<Row>,
  onReleaseError: (error: unknown) => void,
): Readable {
  let complete = false;
  const stream = Readable.from(
    chunks(source, () => {
      complete = true;
    }),
    { objectMode: false },
  );
  stream.once('close', () => {
    void (complete ? trx.commit() : trx.rollback()).execute().catch(onReleaseError);
  });
  return stream;
}
