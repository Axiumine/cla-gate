// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Database } from '../../adapters/db/schema.ts';
import { migratedTestDatabase, realPostgresOnly, seedTenant, withConnections } from '../../adapters/db/test-support.ts';
import { csvRecords } from '../../domain/csv-fixture/test-support.ts';
import { ACTOR } from '../test-support.ts';
import { readBytes, runExport, seedSignatures } from './export-fixture/test-support.ts';
import { openSignatureExport } from './signature-export.ts';
import type * as Queries from './signature-queries.ts';

// E16-S03 on a real Postgres: PGlite has one session, so it can neither commit a write between two batches of a read nor
// show that the read does not see it. The test of the snapshot is skipped on PGlite and run by the CI `postgres` job; the
// control run, which holds a batch back and lets it go with no write in between, runs on both.

interface Gate {
  /** The batch (counting from 1) that waits. */
  readonly batch: number;
  readonly reached: PromiseWithResolvers<undefined>;
  readonly release: PromiseWithResolvers<undefined>;
}

const probe = vi.hoisted<{ batches: number; gate: Gate | undefined }>(() => ({ batches: 0, gate: undefined }));

vi.mock('./signature-queries.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof Queries>();
  return {
    ...actual,
    signatureBatch: async (...args: Parameters<typeof actual.signatureBatch>) => {
      probe.batches += 1;
      if (probe.batches === probe.gate?.batch) {
        probe.gate.reached.resolve(undefined);
        await probe.gate.release.promise;
      }
      return actual.signatureBatch(...args);
    },
  };
});

beforeEach(() => {
  probe.batches = 0;
  probe.gate = undefined;
});

/** A tenant with 1,500 signatures and the file its export gives while nothing else happens. */
async function world() {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db, 1);
  const ids = await seedSignatures(
    db,
    tenant,
    Array.from({ length: 1500 }, (_unused, index) => ({ githubId: 10_000 + index, signedAtMs: index })),
  );
  const scope = { installationId: tenant.installationId };
  const filter = { documentId: tenant.documentId, state: 'all' } as const;
  return { db, tenant, ids, scope, filter, untouched: await runExport(db, scope, filter) };
}

/**
 * Opens the export on `reader` and reads it with its second batch held back; `between` runs while it waits, and the file
 * is whatever the export wrote once the batch was let go.
 */
async function exportHeldAtSecondBatch(
  reader: Kysely<Database>,
  setting: Awaited<ReturnType<typeof world>>,
  between: () => Promise<void>,
) {
  probe.batches = 0;
  probe.gate = { batch: 2, reached: Promise.withResolvers(), release: Promise.withResolvers() };
  const { gate } = probe;
  const opened = await openSignatureExport(reader, setting.scope, setting.filter, {
    actor: ACTOR,
    onReleaseError: (error) => {
      throw error;
    },
  });
  const reading = readBytes(opened.stream);
  // The first thousand rows are read; the second batch waits while `between` runs.
  await gate.reached.promise;
  await between();
  gate.release.resolve(undefined);
  return { text: (await reading).toString('utf8'), rowCount: opened.rowCount };
}

test('an export held back between two batches, with nothing written meanwhile, is the file of an export that was not', async () => {
  const setting = await world();
  const held = await exportHeldAtSecondBatch(setting.db, setting, () => Promise.resolve());
  expect(held.text).toBe(setting.untouched.text);
  expect(held.rowCount).toBe(1500);
});

realPostgresOnly(
  'a signature added and one revoked by another session between two batches are not in the file: it shows the state of its snapshot',
  async () => {
    const setting = await world();
    const { db, tenant, ids, scope, filter } = setting;
    const connections = withConnections(2);
    const writer = connections.get(1);
    const held = await exportHeldAtSecondBatch(connections.get(0), setting, async () => {
      await seedSignatures(writer, tenant, [{ githubId: 99_001 }]);
      await writer
        .updateTable('signatures')
        .set({ revoked_at: new Date(), revoked_by: tenant.publisherId, revoke_reason: 'other' })
        .where('id', 'in', ids.slice(1200, 1201))
        .execute();
    });

    expect(held.text).toBe(setting.untouched.text);
    expect(held.rowCount).toBe(1500);

    const later = csvRecords((await runExport(db, scope, filter)).text);
    expect(later).toHaveLength(1501);
    expect(later.filter((record) => record['state'] === 'revoked')).toHaveLength(1);
  },
);
