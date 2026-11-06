// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { beforeEach, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { migratedTestDatabase } from '../../adapters/db/test-support.ts';
import { parseCsv } from '../../domain/csv-fixture/test-support.ts';
import { CORPORATE_EXPORT_BATCH_SIZE, openCorporateExport } from './corporate-export.ts';
import {
  corporationOf,
  EXPORTER,
  runCorporateExport,
  seedUserApprovals,
  signFor,
} from './corporate-export-fixture/test-support.ts';
import type * as Queries from './corporate-export-queries.ts';

// How the corporate exports read (E21-S05): in batches of 1,000 rows by keyset on the id, inside one read-only repeatable read transaction, and
// what happens when a batch fails or the reader goes away. The queries are wrapped to record the batches and to fail on demand; they still run
// against the migrated database.

interface BatchCall {
  readonly afterId: number;
  readonly limit: number;
  readonly rows: number;
}

interface Probe {
  readonly batches: BatchCall[];
  /** Every read of a batch, settled or not: a batch the stream asked for before it was destroyed ends after the test did. */
  readonly calls: Promise<unknown>[];
  failOnBatch: number;
  readonly settings: unknown[];
}

const probe = vi.hoisted<Probe>(() => ({ batches: [], calls: [], failOnBatch: 0, settings: [] }));

vi.mock('./corporate-export-queries.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof Queries>();
  return {
    ...actual,
    approvalExportBatch: (...args: Parameters<typeof actual.approvalExportBatch>) => {
      const call = (async () => {
        const [db, , { afterId, limit }] = args;
        if (probe.batches.length === 0) {
          const settings =
            await sql`select current_setting('transaction_isolation') as isolation, current_setting('transaction_read_only') as read_only`.execute(
              db,
            );
          probe.settings.push(...settings.rows);
        }
        if (probe.batches.length + 1 === probe.failOnBatch) {
          probe.batches.push({ afterId, limit, rows: -1 });
          throw new Error('injected batch failure');
        }
        const rows = await actual.approvalExportBatch(...args);
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
  probe.failOnBatch = 0;
});

async function world(approvals: number) {
  const { db } = await migratedTestDatabase();
  const corporation = await corporationOf(db, 1);
  const signed = await signFor(db, corporation, { githubId: 6001, companyName: 'Acme Corp' });
  const ids = await seedUserApprovals(db, signed, approvals);
  return { db, ids, scope: { installationId: corporation.tenant.installationId } };
}

/** The approval ids of the data rows of a file, in file order. */
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
] as const)(
  '%i approvals are read in batches that start after row %j, never more than 1,000 at a time',
  async (total, starts) => {
    const { db, scope, ids } = await world(total);
    const run = await runCorporateExport(db, scope, 'approvals');
    expect(CORPORATE_EXPORT_BATCH_SIZE).toBe(1000);
    expect(probe.batches.map((batch) => batch.limit)).toEqual(starts.map(() => 1000));
    expect(probe.batches.map((batch) => batch.afterId)).toEqual(
      starts.map((start) => (start === 0 ? 0 : (ids[start - 1] ?? 0))),
    );
    expect(probe.batches.reduce((sum, batch) => sum + batch.rows, 0)).toBe(total);
    expect(idsInFile(run.text)).toEqual(ids);
    expect(new Set(idsInFile(run.text)).size).toBe(total);
    expect(run.releaseErrors).toEqual([]);
  },
);

test('the batches are read in one read-only repeatable read transaction', async () => {
  const { db, scope } = await world(3);
  await runCorporateExport(db, scope, 'approvals');
  expect(probe.settings).toEqual([{ isolation: 'repeatable read', read_only: 'on' }]);
});

test('a batch that fails destroys the stream after the rows already sent and gives the connection back', async () => {
  const { db, scope } = await world(2500);
  probe.failOnBatch = 2;
  const stream = await openCorporateExport(db, scope, 'approvals', {
    actor: EXPORTER,
    onReleaseError: () => undefined,
  });
  const received: Buffer[] = [];
  stream.on('data', (chunk: unknown) => {
    received.push(z.instanceof(Buffer).parse(chunk));
  });
  const failure = await new Promise<unknown>((resolve) => {
    stream.once('error', resolve);
  });
  expect(failure).toMatchObject({ message: 'injected batch failure' });
  expect(Buffer.concat(received).toString('utf8').split('\r\n')).toHaveLength(1 + 1000 + 1);
  expect(stream.destroyed).toBe(true);
  // The rollback runs on the close of the stream; a read on the same connection only answers once the snapshot is over.
  expect(await db.selectFrom('corporate_approvals').select('id').limit(1).execute()).toHaveLength(1);
});

test('a reader that goes away after the first chunk leaves the connection free', async () => {
  const { db, scope } = await world(2500);
  const stream = await openCorporateExport(db, scope, 'approvals', {
    actor: EXPORTER,
    onReleaseError: () => undefined,
  });
  const first = await new Promise<unknown>((resolve) => {
    stream.once('data', resolve);
  });
  expect(String(first)).toBe('approval_id,agreement_id,kind,subject,source,approved_at,expires_at,revoked_at\r\n');
  stream.destroy();
  await Promise.allSettled(probe.calls);
  expect(await db.selectFrom('corporate_approvals').select('id').limit(1).execute()).toHaveLength(1);
});

test('a stream destroyed before anything was read still gives the connection back', async () => {
  const { db, scope } = await world(5);
  const stream = await openCorporateExport(db, scope, 'approvals', {
    actor: EXPORTER,
    onReleaseError: () => undefined,
  });
  stream.destroy();
  expect(await db.selectFrom('corporate_approvals').select('id').limit(1).execute()).toHaveLength(1);
  expect(probe.batches).toEqual([]);
});
