// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { beforeEach, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { migratedTestDatabase, rowId, seedTenant } from '../../adapters/db/test-support.ts';
import { parseCsv } from '../../domain/csv-fixture/test-support.ts';
import { ACTOR } from '../test-support.ts';
import { runExport, seedSignatures } from './export-fixture/test-support.ts';
import { ExportChangedError, openSignatureExport } from './signature-export.ts';
import type * as Queries from './signature-queries.ts';
import { EXPORT_BATCH_SIZE } from './signature-stream.ts';

// How the export reads (E16-S03): in batches of 1,000 rows by keyset on the id, inside one read-only repeatable read
// transaction, with the audit row committed before the snapshot, and what happens when a batch fails or the signatures change.
// The queries are wrapped to record the batches and to fail on demand; they still run against the migrated database.

interface BatchCall {
  readonly afterId: number;
  readonly limit: number;
  readonly rows: number;
}

interface Probe {
  readonly batches: BatchCall[];
  /** Every read of a batch, settled or not: a batch the stream asked for before it was destroyed ends after the test did. */
  readonly calls: Promise<unknown>[];
  counts: number;
  failOnBatch: number;
  recountExtra: number;
  failRecount: boolean;
  readonly settings: unknown[];
  readonly audited: unknown[];
}

const probe = vi.hoisted<Probe>(() => ({
  batches: [],
  calls: [],
  counts: 0,
  failOnBatch: 0,
  recountExtra: 0,
  failRecount: false,
  settings: [],
  audited: [],
}));

vi.mock('./signature-queries.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof Queries>();
  return {
    ...actual,
    countSignatures: async (...args: Parameters<typeof actual.countSignatures>) => {
      probe.counts += 1;
      if (probe.failRecount && probe.counts === 2) {
        throw new Error('injected recount failure');
      }
      const count = await actual.countSignatures(...args);
      return probe.counts === 2 ? count + probe.recountExtra : count;
    },
    signatureBatch: (...args: Parameters<typeof actual.signatureBatch>) => {
      const call = (async () => {
        const [db, , , { afterId, limit }] = args;
        if (probe.batches.length === 0) {
          const settings =
            await sql`select current_setting('transaction_isolation') as isolation, current_setting('transaction_read_only') as read_only`.execute(
              db,
            );
          probe.settings.push(...settings.rows);
          const audit =
            await sql`select count(*)::int as n from audit_log where action = 'signatures.exported'`.execute(db);
          probe.audited.push(...audit.rows);
        }
        if (probe.batches.length + 1 === probe.failOnBatch) {
          probe.batches.push({ afterId, limit, rows: -1 });
          throw new Error('injected batch failure');
        }
        const rows = await actual.signatureBatch(...args);
        probe.batches.push({ afterId, limit, rows: rows.length });
        return rows;
      })();
      probe.calls.push(call);
      return call;
    },
  };
});

beforeEach(() => {
  probe.batches.length = 0;
  probe.calls.length = 0;
  probe.settings.length = 0;
  probe.audited.length = 0;
  probe.counts = 0;
  probe.failOnBatch = 0;
  probe.recountExtra = 0;
  probe.failRecount = false;
});

async function world(signatures: number) {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db, 1);
  const ids = await seedSignatures(
    db,
    tenant,
    Array.from({ length: signatures }, (_unused, index) => ({ githubId: 10_000 + index, signedAtMs: index })),
  );
  const scope = { installationId: tenant.installationId };
  return { db, tenant, scope, ids, filter: { documentId: tenant.documentId, state: 'all' } as const };
}

/** The signature ids of the data rows of a file, in file order. */
const idsInFile = (text: string): number[] =>
  parseCsv(text)
    .slice(1)
    .map((cells) => Number(cells[0]));

test.each([
  [0, [0]],
  [1, [0]],
  [999, [0]],
  [1000, [0, 1000]],
  [1001, [0, 1000]],
  [2500, [0, 1000, 2000]],
] as const)(
  '%i signatures are read in batches that start after row %j, never more than 1,000 at a time',
  async (total, starts) => {
    const { db, scope, filter, ids } = await world(total);
    const run = await runExport(db, scope, filter);
    expect(EXPORT_BATCH_SIZE).toBe(1000);
    expect(probe.batches.map((batch) => batch.limit)).toEqual(starts.map(() => 1000));
    expect(probe.batches.map((batch) => batch.afterId)).toEqual(
      starts.map((start) => (start === 0 ? 0 : (ids[start - 1] ?? 0))),
    );
    expect(probe.batches.every((batch) => batch.rows <= 1000)).toBe(true);
    expect(probe.batches.reduce((sum, batch) => sum + batch.rows, 0)).toBe(total);
    expect(idsInFile(run.text)).toEqual(ids);
    expect(new Set(idsInFile(run.text)).size).toBe(total);
    expect(run.rowCount).toBe(total);
    expect(run.releaseErrors).toEqual([]);
  },
);

test('the batches are read in one read-only repeatable read transaction, after the audit row was committed', async () => {
  const { db, scope, filter } = await world(3);
  await runExport(db, scope, filter);
  expect(probe.settings).toEqual([{ isolation: 'repeatable read', read_only: 'on' }]);
  expect(probe.audited).toEqual([{ n: 1 }]);
});

test('a batch that fails destroys the stream after the rows already sent, keeps the audit row and gives the connection back', async () => {
  const { db, scope, filter } = await world(2500);
  probe.failOnBatch = 2;
  const opened = await openSignatureExport(db, scope, filter, { actor: ACTOR, onReleaseError: () => undefined });
  const received: Buffer[] = [];
  opened.stream.on('data', (chunk: unknown) => {
    received.push(z.instanceof(Buffer).parse(chunk));
  });
  const failure = await new Promise<unknown>((resolve) => {
    opened.stream.once('error', resolve);
  });
  expect(failure).toMatchObject({ message: 'injected batch failure' });
  const partial = Buffer.concat(received).toString('utf8');
  expect(partial.split('\r\n')).toHaveLength(1 + 1000 + 1);
  expect(opened.stream.destroyed).toBe(true);
  expect(opened.stream.errored?.message).toBe('injected batch failure');
  const audit = await db
    .selectFrom('audit_log')
    .select('metadata')
    .where('action', '=', 'signatures.exported')
    .execute();
  expect(audit).toEqual([{ metadata: { state: 'all', row_count: 2500 } }]);
});

test('a reader that goes away after the first chunk leaves the audit row and the connection free', async () => {
  const { db, scope, filter } = await world(2500);
  const opened = await openSignatureExport(db, scope, filter, { actor: ACTOR, onReleaseError: () => undefined });
  const first = await new Promise<unknown>((resolve) => {
    opened.stream.once('data', resolve);
  });
  expect(String(first).startsWith('signature_id,')).toBe(true);
  opened.stream.destroy();
  expect(
    await db.selectFrom('audit_log').select('id').where('action', '=', 'signatures.exported').execute(),
  ).toHaveLength(1);
  // The batch the stream had asked for ends after the destroy; the test waits for it so that it does not leak into the next.
  await Promise.allSettled(probe.calls);
});

test('a stream destroyed before anything was read still gives the connection back', async () => {
  const { db, scope, filter } = await world(5);
  const opened = await openSignatureExport(db, scope, filter, { actor: ACTOR, onReleaseError: () => undefined });
  opened.stream.destroy();
  expect(await db.selectFrom('audit_log').select('id').execute()).toHaveLength(1);
  expect(probe.batches).toEqual([]);
});

test('when the count in the snapshot is not the one in the audit row nothing is sent, the row stays and the connection is free', async () => {
  const { db, scope, filter } = await world(4);
  probe.recountExtra = 1;
  await expect(
    openSignatureExport(db, scope, filter, { actor: ACTOR, onReleaseError: () => undefined }),
  ).rejects.toBeInstanceOf(ExportChangedError);
  expect(probe.batches).toEqual([]);
  const audit = await db
    .selectFrom('audit_log')
    .select('metadata')
    .where('action', '=', 'signatures.exported')
    .execute();
  expect(audit).toEqual([{ metadata: { state: 'all', row_count: 4 } }]);
});

test('a count that fails in the snapshot sends nothing, gives the connection back and reports the failure itself', async () => {
  const { db, scope, filter } = await world(4);
  probe.failRecount = true;
  await expect(
    openSignatureExport(db, scope, filter, { actor: ACTOR, onReleaseError: () => undefined }),
  ).rejects.toThrow('injected recount failure');
  expect(probe.batches).toEqual([]);
  // The next statement would wait for ever if the snapshot were still open on the only connection.
  expect(
    await db.selectFrom('audit_log').select('id').where('action', '=', 'signatures.exported').execute(),
  ).toHaveLength(1);
});

test('an audit row that cannot be written stops the export before any snapshot is taken, and leaves the connection free', async () => {
  const { db, tenant } = await world(1);
  const stranger = { installationId: rowId(tenant.installationId + 1000) };
  const options = { actor: ACTOR, onReleaseError: () => undefined };
  await expect(
    openSignatureExport(db, stranger, { documentId: tenant.documentId, state: 'all' }, options),
  ).rejects.toThrow();
  expect(probe.counts).toBe(1);
  expect(probe.batches).toEqual([]);
  expect(await db.selectFrom('audit_log').select('id').execute()).toEqual([]);
});
