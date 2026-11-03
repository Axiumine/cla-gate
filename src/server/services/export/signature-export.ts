// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Readable } from 'node:stream';
import type { ControlledTransaction, Kysely } from 'kysely';
import type { GithubId } from '../../../shared/github-id.ts';
import type { Database } from '../../adapters/db/schema.ts';
import type { TenantScope } from '../../adapters/db/tenant-scope.ts';
import { recordExport } from './signature-export-record.ts';
import type { SignatureFilter } from './signature-filter.ts';
import { countSignatures } from './signature-queries.ts';
import { csvStream } from './signature-stream.ts';

// The signature export of a document (E16-S03): the audit row first, then the file, read in batches from one snapshot
// (signature-stream.ts).

/**
 * The signatures of the filter changed between the moment the export was recorded and the moment its snapshot was taken,
 * so the row count in the audit row would not be the number of rows in the file. Nothing was sent; the caller asks again.
 */
export class ExportChangedError extends Error {
  override readonly name = 'ExportChangedError';

  constructor() {
    super('the signatures changed while the export was being prepared');
  }
}

/** An export ready to send: the number of its rows, and the file as a stream. */
export interface SignatureExport {
  /** The signatures in the file, header row not counted. It is what the audit row says. */
  readonly rowCount: number;
  /** The CSV as UTF-8, header row first. Read to the end it commits its snapshot; destroyed early it gives the connection back. */
  readonly stream: Readable;
}

/** Who asks, and what to do when the end of the snapshot fails after the file was sent. */
export interface ExportOptions {
  /** The numeric GitHub id of the person who exports: the actor of the audit row. */
  readonly actor: GithubId;
  /** Hears of a snapshot that could not be committed or rolled back. The response is done by then; the error is for the log. */
  readonly onReleaseError: (error: unknown) => void;
}

/**
 * Starts the export of the signatures of `filter` in the tenant. The audit row `signatures.exported` is committed first;
 * then one read-only `repeatable read` transaction is opened, so every batch of the file comes from the same snapshot and a
 * signing or a revocation that commits meanwhile cannot tear it. Its first statement counts the rows again: when the count
 * is not the one the audit row holds, nothing is sent. The transaction stays open until the stream ends or is destroyed.
 * @throws ExportChangedError when the signatures changed between the audit row and the snapshot.
 */
export async function openSignatureExport(
  db: Kysely<Database>,
  scope: TenantScope,
  filter: SignatureFilter,
  options: ExportOptions,
): Promise<SignatureExport> {
  const rowCount = await recordExport(db, scope, filter, options.actor);
  const trx = await db.startTransaction().setIsolationLevel('repeatable read').setAccessMode('read only').execute();
  const current = await countSignatures(trx, scope, filter).catch((error: unknown) => abandon(trx, error));
  if (current !== rowCount) {
    return abandon(trx, new ExportChangedError());
  }
  return { rowCount, stream: csvStream(trx, scope, filter, options.onReleaseError) };
}

/** Gives the connection back and rethrows `reason`: nothing was sent, so nothing is left to commit. */
async function abandon(trx: ControlledTransaction<Database>, reason: unknown): Promise<never> {
  await trx.rollback().execute();
  throw reason;
}
