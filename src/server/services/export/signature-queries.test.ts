// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import { expect, test } from 'vitest';
import { SIGNATURE_EXPORT_STATES, type SignatureExportState } from '../../../shared/signature-export.ts';
import type { Database } from '../../adapters/db/schema.ts';
import type { TenantScope } from '../../adapters/db/tenant-scope.ts';
import { migratedTestDatabase, seedTenant } from '../../adapters/db/test-support.ts';
import { signatureState } from '../../domain/signature-state.ts';
import { activateMajor, type SignatureSeed, seedInstant, seedSignatures } from './export-fixture/test-support.ts';
import type { SignatureFilter } from './signature-filter.ts';
import { countSignatures, signatureBatch } from './signature-queries.ts';

// What the export reads (E16-S03): the four states against the pure function, the bounds on the time of the signature at the
// millisecond, the keyset, and the tenant and the document every statement names.

async function world() {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db, 1);
  const scope = { installationId: tenant.installationId };
  return { db, tenant, scope };
}

/** The ids of the signatures a filter selects, in the order of the keyset. */
async function idsOf(db: Kysely<Database>, scope: TenantScope, filter: SignatureFilter): Promise<number[]> {
  return (await signatureBatch(db, scope, filter, { afterId: 0, limit: 100 })).map((row) => row.signature_id);
}

test('each state selects the signatures the pure signatureState function puts in it, for every mix of major and revocation', async () => {
  const { db, tenant, scope } = await world();
  const first = { id: tenant.versionId, major: 1, sha256: tenant.contentSha256 };
  const second = await activateMajor(db, tenant, 2);
  const revoked = { afterMs: 10, byGithubId: 99, reason: 'other' } as const;
  const seeds: SignatureSeed[] = [
    { githubId: 1, version: first },
    { githubId: 2, version: second },
    { githubId: 3, version: first, revoked },
    { githubId: 4, version: second, revoked },
  ];
  const ids = await seedSignatures(db, tenant, seeds);
  const expected = (state: SignatureExportState) =>
    ids.filter((_id, index) => {
      const seed = seeds.at(index);
      return (
        state === 'all' ||
        signatureState({ revoked: seed?.revoked !== undefined, major: seed?.version?.major ?? 1 }, 2) === state
      );
    });
  for (const state of SIGNATURE_EXPORT_STATES) {
    const filter = { documentId: tenant.documentId, state };
    expect(await idsOf(db, scope, filter), state).toEqual(expected(state));
    expect(await countSignatures(db, scope, filter), state).toBe(expected(state).length);
  }
  expect(await countSignatures(db, scope, { documentId: tenant.documentId, state: 'outdated' })).toBe(1);
  expect(await countSignatures(db, scope, { documentId: tenant.documentId, state: 'active' })).toBe(1);
  expect(await countSignatures(db, scope, { documentId: tenant.documentId, state: 'revoked' })).toBe(2);
});

test('a document with no active version has every signature that is not revoked active, and none outdated', async () => {
  const { db, tenant, scope } = await world();
  const document = await db
    .insertInto('cla_documents')
    .values({
      installation_id: tenant.installationId,
      repository_id: null,
      name: 'Draft only CLA',
      kind: 'individual',
      active_version_id: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const version = await activateMajor(db, { documentId: document.id, publisherId: tenant.publisherId }, 1);
  await db.updateTable('cla_documents').set({ active_version_id: null }).where('id', '=', document.id).execute();
  const target = { ...tenant, documentId: document.id, versionId: version.id, contentSha256: version.sha256 };
  await seedSignatures(db, target, [
    { githubId: 1 },
    { githubId: 2, revoked: { afterMs: 1, byGithubId: 1, reason: 'other' } },
  ]);
  const counts = await Promise.all(
    SIGNATURE_EXPORT_STATES.map((state) => countSignatures(db, scope, { documentId: document.id, state })),
  );
  expect(counts).toEqual([1, 0, 1, 2]);
});

test('from is inclusive and to is exclusive on the time of the signature, to the millisecond', async () => {
  const { db, tenant, scope } = await world();
  const at = (offsetMs: number): SignatureSeed => ({ githubId: 100 + offsetMs + 1, signedAtMs: 10_000 + offsetMs });
  const ids = await seedSignatures(db, tenant, [at(-1), at(0), at(1), at(998), at(999), at(1000), at(1001)]);
  const filter = {
    documentId: tenant.documentId,
    state: 'all',
    from: seedInstant(10_000),
    to: seedInstant(11_000),
  } as const;
  expect(await idsOf(db, scope, filter)).toEqual(ids.slice(1, 5));
  expect(await countSignatures(db, scope, filter)).toBe(4);
  expect(await idsOf(db, scope, { ...filter, to: undefined })).toEqual(ids.slice(1));
  expect(await idsOf(db, scope, { ...filter, from: undefined })).toEqual(ids.slice(0, 5));
  expect(await idsOf(db, scope, { ...filter, from: seedInstant(10_001), to: seedInstant(10_001) })).toEqual([]);
});

test('a row is compared at the microsecond the database stores, a bound at the millisecond it was written with', async () => {
  const { db, tenant, scope } = await world();
  const [id] = await seedSignatures(db, tenant, [{ githubId: 1, signedAtMs: 5000 }]);
  const filter = { documentId: tenant.documentId, state: 'all' } as const;
  const instant = seedInstant(5000);
  expect(await idsOf(db, scope, { ...filter, from: instant, to: new Date(instant.getTime() + 1) })).toEqual([id]);
  expect(await idsOf(db, scope, { ...filter, to: instant })).toEqual([]);
});

test('the keyset returns the rows above the id in the order of the id, at most the limit', async () => {
  const { db, tenant, scope } = await world();
  const ids = await seedSignatures(
    db,
    tenant,
    Array.from({ length: 7 }, (_unused, index) => ({ githubId: 200 + index })),
  );
  const filter = { documentId: tenant.documentId, state: 'all' } as const;
  const rows = async (afterId: number, limit: number) =>
    (await signatureBatch(db, scope, filter, { afterId, limit })).map((row) => row.signature_id);
  expect(await rows(0, 3)).toEqual(ids.slice(0, 3));
  expect(await rows(ids[2] ?? 0, 3)).toEqual(ids.slice(3, 6));
  expect(await rows(ids[5] ?? 0, 3)).toEqual(ids.slice(6));
  expect(await rows(ids[6] ?? 0, 3)).toEqual([]);
  expect(ids).toEqual(ids.toSorted((a, b) => a - b));
});

test('another document of the tenant, and the same document read by another tenant, select nothing of the first', async () => {
  const { db, tenant, scope } = await world();
  const other = await seedTenant(db, 2);
  const otherScope = { installationId: other.installationId };
  const [own] = await seedSignatures(db, tenant, [{ githubId: 300 }]);
  const [foreign] = await seedSignatures(db, other, [{ githubId: 300 }]);
  const own1 = { documentId: tenant.documentId, state: 'all' } as const;
  const own2 = { documentId: other.documentId, state: 'all' } as const;
  expect(await idsOf(db, scope, own1)).toEqual([own]);
  expect(await idsOf(db, otherScope, own2)).toEqual([foreign]);
  expect(await idsOf(db, scope, own2)).toEqual([]);
  expect(await idsOf(db, otherScope, own1)).toEqual([]);
  expect(await countSignatures(db, scope, own2)).toBe(0);
  expect(await countSignatures(db, otherScope, own1)).toBe(0);
});
