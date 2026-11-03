// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { ROW_TABLES, type RowTable, type TwoTenants, twoTenants } from '../db/tenant-fixture/test-support.ts';
import { migratedTestDatabase } from '../db/test-support.ts';
import {
  type CaseTables,
  CROSS_TENANT_CASES,
  ISOLATION_CASES,
  matrixGaps,
  NO_TENANT_DATA,
} from './cross-tenant-fixture/test-support.ts';
import { ownerOf } from './cross-tenant-runner/test-support.ts';
import { tenantAccess } from './tenant-access.ts';

// The completeness check of the route matrix (E11-S06): it names the route that has no case, and the case that names no
// route. The tables of the application are held to its real route table in cross-tenant-matrix.test.ts; here the check is
// shown on made-up tables.

const tenant = tenantAccess({ mode: 'read', resolve: () => Promise.resolve(null) });
const route = (method: string, url: string, access: unknown) => ({ method, url, access });

const TABLE = [
  route('GET', '/healthz', 'public'),
  route('POST', '/webhooks/github', 'webhook'),
  route('GET', '/api/operator/installations', 'operator'),
  route('GET', '/api/installations/:installationId', tenant),
  route('GET', '/api/me/signatures', 'authenticated'),
  route('GET', '/api/auth/session', 'authenticated'),
  route('GET', '/odd', 'admin'),
  route('GET', '/none', undefined),
];

/** A case table entry: the matrix only reads the keys here. */
const entry = {};

const COMPLETE: CaseTables = {
  cross: { 'GET /api/installations/:installationId': entry },
  isolation: { 'GET /api/me/signatures': entry },
  noTenantData: { 'GET /api/auth/session': 'it returns the caller only' },
};

test('a table with a case for every tenant route and a place for every authenticated route has no gap, whatever the other routes are', () => {
  expect(matrixGaps(TABLE, COMPLETE)).toEqual([]);
});

test('a tenant route with no case is named, with its method and path', () => {
  expect(matrixGaps(TABLE, { ...COMPLETE, cross: {} })).toEqual([
    'tenant route GET /api/installations/:installationId has no entry in CROSS_TENANT_CASES',
  ]);
});

test('a case for a route that is not a tenant route is named, so a renamed route does not leave its case behind', () => {
  expect(
    matrixGaps(TABLE, {
      ...COMPLETE,
      cross: { ...COMPLETE.cross, 'GET /api/installations/:id': entry, 'GET /healthz': entry },
    }),
  ).toEqual([
    'CROSS_TENANT_CASES has an entry for GET /api/installations/:id, which is not a tenant route',
    'CROSS_TENANT_CASES has an entry for GET /healthz, which is not a tenant route',
  ]);
});

test('an authenticated route that is in neither second table is named', () => {
  expect(matrixGaps(TABLE, { ...COMPLETE, isolation: {} })).toEqual([
    'authenticated route GET /api/me/signatures is in neither ISOLATION_CASES nor NO_TENANT_DATA',
  ]);
  expect(matrixGaps(TABLE, { ...COMPLETE, noTenantData: {} })).toEqual([
    'authenticated route GET /api/auth/session is in neither ISOLATION_CASES nor NO_TENANT_DATA',
  ]);
});

test('an entry of the second tables for a route that is not authenticated is named', () => {
  const gaps = matrixGaps(TABLE, {
    ...COMPLETE,
    isolation: { ...COMPLETE.isolation, 'GET /api/installations/:installationId': entry },
    noTenantData: { ...COMPLETE.noTenantData, 'GET /healthz': 'public' },
  });
  expect(gaps).toEqual([
    'ISOLATION_CASES has an entry for GET /api/installations/:installationId, which is not an authenticated route',
    'NO_TENANT_DATA has an entry for GET /healthz, which is not an authenticated route',
  ]);
});

test('a route that says it returns tenant data and that it returns none is named', () => {
  expect(
    matrixGaps(TABLE, { ...COMPLETE, noTenantData: { ...COMPLETE.noTenantData, 'GET /api/me/signatures': 'both' } }),
  ).toEqual(['GET /api/me/signatures is in ISOLATION_CASES and in NO_TENANT_DATA']);
});

test('every gap is reported at once, in the order tenant, authenticated, stale, both', () => {
  const gaps = matrixGaps(TABLE, { cross: { 'GET /nowhere': entry }, isolation: {}, noTenantData: {} });
  expect(gaps).toEqual([
    'tenant route GET /api/installations/:installationId has no entry in CROSS_TENANT_CASES',
    'CROSS_TENANT_CASES has an entry for GET /nowhere, which is not a tenant route',
    'authenticated route GET /api/me/signatures is in neither ISOLATION_CASES nor NO_TENANT_DATA',
    'authenticated route GET /api/auth/session is in neither ISOLATION_CASES nor NO_TENANT_DATA',
  ]);
});

test('the tables of the application hold the cases of the routes the stories added, and the two authenticated routes it has say why they return no tenant data', () => {
  expect(Object.keys(CROSS_TENANT_CASES)).toEqual([
    'GET /api/installations/:installationId/audit-log',
    'GET /api/installations/:installationId/documents/:documentId/signatures.csv',
    'GET /api/installations/:installationId/erasure-preview',
    'POST /api/installations/:installationId/erasures',
  ]);
  expect(ISOLATION_CASES).toEqual({});
  expect(Object.keys(NO_TENANT_DATA)).toEqual(['GET /api/auth/session', 'POST /api/auth/logout']);
  expect(Object.values(NO_TENANT_DATA).every((reason) => reason.length > 20)).toBe(true);
});

type Db = Awaited<ReturnType<typeof migratedTestDatabase>>['db'];

const none = (): null => null;
const idOf = (value: (w: TwoTenants) => number) => (_db: Db, w: TwoTenants) => Promise.resolve(value(w));

/** Each tenant table a response can name a row of, with how to find a row of tenant 1 and whom the row is about. */
const OWNED: readonly (readonly [
  RowTable,
  (db: Db, w: TwoTenants) => Promise<number>,
  (w: TwoTenants) => number | null,
])[] = [
  ['repositories', idOf((w) => w.t1.plain.repositoryId), none],
  ['cla_documents', idOf((w) => w.t1.documentId), none],
  ['cla_versions', idOf((w) => w.t1.versionId), none],
  ['signatures', idOf((w) => w.t1.signatureId), (w) => w.people.member1.userId],
  ['signer_pii', idOf((w) => w.t1.signatureId), (w) => w.people.member1.userId],
  [
    'commit_overrides',
    async (db, w) =>
      (
        await db
          .selectFrom('commit_overrides')
          .select('id')
          .where('installation_id', '=', w.t1.installationId)
          .executeTakeFirstOrThrow()
      ).id,
    (w) => w.t1.publisherId,
  ],
  [
    'allowlist_entries',
    async (db, w) =>
      (
        await db
          .selectFrom('allowlist_entries')
          .select('id')
          .where('installation_id', '=', w.t1.installationId)
          .executeTakeFirstOrThrow()
      ).id,
    none,
  ],
  [
    'pr_evaluations',
    async (db, w) =>
      (
        await db
          .selectFrom('pr_evaluations')
          .select('id')
          .where('installation_id', '=', w.t1.installationId)
          .executeTakeFirstOrThrow()
      ).id,
    none,
  ],
  [
    'audit_log',
    async (db, w) =>
      (
        await db
          .selectFrom('audit_log')
          .select('id')
          .where('installation_id', '=', w.t1.installationId)
          .executeTakeFirstOrThrow()
      ).id,
    none,
  ],
];

test('the table above names every tenant table whose rows have an id a response can name', () => {
  expect(OWNED.map(([table]) => table)).toEqual([...ROW_TABLES]);
});

test.each(OWNED)(
  'the owner of a row of %s is read from the database: its tenant, and the person it is about',
  async (table, find, about) => {
    const { db } = await migratedTestDatabase();
    const world = await twoTenants(db);
    const owner = await ownerOf(db, { table, id: await find(db, world) });
    expect(owner).toEqual({ installationId: world.t1.installationId, userId: about(world) });
  },
);

test('a row that does not exist has no owner', async () => {
  const { db } = await migratedTestDatabase();
  await twoTenants(db);
  await expect(ownerOf(db, { table: 'signatures', id: 987_654 })).rejects.toThrow();
});
