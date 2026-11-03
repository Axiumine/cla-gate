// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type IncomingHttpHeaders, request } from 'node:http';
import { beforeEach, expect, test, vi } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { parseCsv } from '../../domain/csv-fixture/test-support.ts';
import { seedSignatures } from '../../services/export/export-fixture/test-support.ts';
import type * as Queries from '../../services/export/signature-queries.ts';
import { freePort } from '../../test-support.ts';
import { csvPathOf, csvWorld } from './signature-csv-fixture/test-support.ts';

// What the person at the other end sees when the export breaks, over a real connection (E16-S03): a batch that fails after the
// first bytes went out cuts the connection instead of ending the file as if it were whole, a client that leaves frees the
// database connection, and a file whose count changed between the audit row and the snapshot is a 409. The queries are
// wrapped to fail on demand; they still run against the migrated database.

const probe = vi.hoisted(() => ({ failOnBatch: 0, failOnCount: false, batches: 0, recountExtra: 0, counts: 0 }));

vi.mock('../../services/export/signature-queries.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof Queries>();
  return {
    ...actual,
    countSignatures: async (...args: Parameters<typeof actual.countSignatures>) => {
      probe.counts += 1;
      if (probe.failOnCount) {
        throw new Error('injected count failure');
      }
      const count = await actual.countSignatures(...args);
      return probe.counts === 2 ? count + probe.recountExtra : count;
    },
    signatureBatch: async (...args: Parameters<typeof actual.signatureBatch>) => {
      probe.batches += 1;
      if (probe.batches === probe.failOnBatch) {
        throw new Error('injected batch failure');
      }
      return actual.signatureBatch(...args);
    },
  };
});

beforeEach(() => {
  probe.failOnBatch = 0;
  probe.failOnCount = false;
  probe.batches = 0;
  probe.recountExtra = 0;
  probe.counts = 0;
});

interface Download {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
  /** Whether the whole message arrived: false when the connection was cut or the client left. */
  readonly complete: boolean;
}

/** Downloads `url` with the session `cookie`; `leaveAfterFirstChunk` closes the connection as soon as a byte of the body arrives. */
function download(url: string, cookie: string, leaveAfterFirstChunk = false): Promise<Download> {
  return new Promise((resolve, reject) => {
    const call = request(url, { headers: { cookie } }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        if (leaveAfterFirstChunk) {
          call.destroy();
        }
      });
      // A connection that is cut mid-body is reported as an error of the response; what matters is that it ended.
      response.on('error', () => undefined);
      response.on('close', () => {
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks).toString('utf8'),
          complete: response.complete,
        });
      });
    });
    call.on('error', (error) => {
      if (!leaveAfterFirstChunk) {
        reject(error);
      }
    });
    call.end();
  });
}

/** The real app listening on a random free port, a tenant with the signature of its seed and `signatures` more, and the address of its export. */
async function listening(signatures: number) {
  const world = await csvWorld();
  const { app, db, login, t1 } = world;
  await seedSignatures(
    db,
    t1,
    Array.from({ length: signatures }, (_unused, index) => ({ githubId: 10_000 + index, signedAtMs: index })),
  );
  const address = await app.listen({ host: '127.0.0.1', port: await freePort() });
  const url = `${address}${csvPathOf(t1.installationId, t1.documentId)}`;
  const cookie = (await login(t1.admin.githubId)).cookie;
  return { ...world, url, cookie };
}

/** The audit rows of the exports, with the count they carry. */
async function exportRows(db: Awaited<ReturnType<typeof listening>>['db']) {
  const rows = await db
    .selectFrom('audit_log')
    .select(['subject_type', 'metadata'])
    .where('action', '=', 'signatures.exported')
    .execute();
  return rows.map((row) => [row.subject_type, row.metadata]);
}

test('a batch that fails after the first bytes cuts the connection: the file is never taken for whole, and the export stays on record', async () => {
  const { cookie, db, logs, url } = await listening(1500);
  probe.failOnBatch = 2;
  const answer = await download(url, cookie);
  expect(answer.status).toBe(200);
  expect(answer.complete).toBe(false);
  expect(answer.headers['content-disposition']).toMatch(
    /^attachment; filename="signatures-\d+-\d{4}-\d{2}-\d{2}\.csv"$/,
  );
  // The header row and the first thousand rows went out; the 500 behind them did not.
  expect(answer.body.split('\r\n')).toHaveLength(1 + 1000 + 1);
  expect(await exportRows(db)).toEqual([['document', { state: 'all', row_count: 1501 }]]);
  expect(logs.text()).not.toContain('@example.test');
  expect(logs.text()).not.toContain('Name 10000');
});

test('a client that leaves after the first bytes leaves the audit row and frees the database connection', async () => {
  const { cookie, db, logs, url } = await listening(2500);
  const answer = await download(url, cookie, true);
  expect(answer.status).toBe(200);
  expect(answer.complete).toBe(false);
  // Both calls wait for the connection of the aborted export: they come back only when it was released.
  expect(await exportRows(db)).toEqual([['document', { state: 'all', row_count: 2501 }]]);
  const next = await download(url, cookie);
  expect(next.complete).toBe(true);
  expect(parseCsv(next.body)).toHaveLength(1 + 2501);
  expect(logs.text()).not.toContain('@example.test');
});

test('a count that changed between the audit row and the snapshot is a 409 export_changed, and the audit row stays', async () => {
  const { cookie, db, url } = await listening(3);
  probe.recountExtra = 1;
  const answer = await download(url, cookie);
  expect(answer.status).toBe(409);
  expect(answer.headers['content-disposition']).toBeUndefined();
  expect(errorResponseSchema.parse(JSON.parse(answer.body)).error.code).toBe('export_changed');
  expect(await exportRows(db)).toEqual([['document', { state: 'all', row_count: 4 }]]);
});

test('an error that is not a change of the count is not taken for one: the answer is the 500 of any failure, with no file and no row of the export', async () => {
  const { cookie, db, logs, url } = await listening(3);
  probe.failOnCount = true;
  const answer = await download(url, cookie);
  expect(answer.status).toBe(500);
  expect(answer.headers['content-disposition']).toBeUndefined();
  expect(errorResponseSchema.parse(JSON.parse(answer.body)).error.code).toBe('internal_server_error');
  expect(await exportRows(db)).toEqual([]);
  expect(logs.text()).not.toContain('@example.test');
});
