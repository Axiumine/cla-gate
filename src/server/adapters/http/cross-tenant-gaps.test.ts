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

test('the tables of the application hold the cases of the routes the stories added, and the two authenticated routes that return no tenant data say why', () => {
  expect(Object.keys(CROSS_TENANT_CASES)).toEqual([
    'POST /api/installations/:installationId/documents',
    'GET /api/installations/:installationId/documents',
    'GET /api/installations/:installationId/repositories/:repositoryId/documents',
    'GET /api/installations/:installationId/documents/:documentId',
    'PATCH /api/installations/:installationId/documents/:documentId',
    'GET /api/installations/:installationId/documents/:documentId/draft',
    'PUT /api/installations/:installationId/documents/:documentId/draft',
    'DELETE /api/installations/:installationId/documents/:documentId/draft',
    'POST /api/installations/:installationId/documents/:documentId/versions',
    'GET /api/installations/:installationId/documents/:documentId/versions',
    'GET /api/installations/:installationId/documents/:documentId/versions/:versionId',
    'GET /api/installations/:installationId/audit-log',
    'GET /api/installations/:installationId/documents/:documentId/signatures.csv',
    'GET /api/installations/:installationId/repositories',
    'PUT /api/repositories/:repositoryId/cla-document',
    'POST /api/repositories/:repositoryId/enable',
    'POST /api/repositories/:repositoryId/disable',
    'POST /api/installations/:installationId/allowlist-entries',
    'POST /api/repositories/:repositoryId/allowlist-entries',
    'GET /api/installations/:installationId/allowlist-entries',
    'GET /api/repositories/:repositoryId/allowlist-entries',
    'DELETE /api/installations/:installationId/allowlist-entries/:entryId',
    'PUT /api/installations/:installationId/repositories/:repositoryId/public-verification',
    'GET /api/installations/:installationId/erasure-preview',
    'POST /api/installations/:installationId/erasures',
  ]);
  expect(Object.keys(ISOLATION_CASES)).toEqual([
    'GET /api/installations',
    'GET /api/me/export',
    'GET /api/sign/:githubRepoId',
    'POST /api/sign',
    'GET /api/me/signatures',
  ]);
  expect(Object.keys(NO_TENANT_DATA)).toEqual(['GET /api/auth/session', 'POST /api/auth/logout']);
  expect(Object.values(NO_TENANT_DATA).every((reason) => reason.length > 20)).toBe(true);
});

test('the isolation case of the export names the signature rows of an answer, and the personal data row of the ones that still have it', () => {
  const signature = (id: number, personalData: unknown) => ({
    id,
    installation: { githubInstallationId: 5000, accountLogin: 'org-1' },
    document: { id: 1, name: 'Individual CLA' },
    version: { id: 1, major: 1, minor: 0, contentSha256: 'a'.repeat(64) },
    consentTextId: 'consent-v1',
    signerType: 'individual',
    signedAt: '2026-11-02T10:00:00.000Z',
    source: { repositoryFullName: null, prNumber: null },
    revokedAt: null,
    revokeReasonCode: null,
    personalData,
  });
  const pii = { name: 'Ada', email: 'ada@example.test', login: 'ada', ipAddress: null, userAgent: null };
  const body = {
    schemaVersion: 1,
    exportedAt: '2026-11-02T10:00:00.000Z',
    user: { githubId: 7, login: 'ada', name: null, createdAt: '2026-11-01T00:00:00.000Z' },
    signatures: [signature(4, pii), signature(3, null)],
    allowlistEntries: [],
    auditEntries: [],
    truncated: false,
  };
  expect(ISOLATION_CASES['GET /api/me/export']?.rows(body)).toEqual([
    { table: 'signatures', id: 4 },
    { table: 'signer_pii', id: 4 },
    { table: 'signatures', id: 3 },
  ]);
});

test('the isolation case of the export compares two answers without their audit entries and with everything else', () => {
  const document = (auditEntries: unknown[], login: string) => ({
    schemaVersion: 1,
    exportedAt: '2026-11-02T10:00:00.000Z',
    user: { githubId: 7, login, name: null, createdAt: '2026-11-01T00:00:00.000Z' },
    signatures: [],
    allowlistEntries: [],
    auditEntries,
    truncated: false,
  });
  const entry = {
    occurredAt: '2026-11-02T10:00:00.000Z',
    action: 'data_export.created',
    installationId: null,
    subject: null,
  };
  const stable = ISOLATION_CASES['GET /api/me/export']?.stable;
  expect(stable?.(document([entry], 'ada'))).toEqual(stable?.(document([], 'ada')));
  expect(stable?.(document([], 'ada'))).not.toEqual(stable?.(document([], 'eve')));
});

test('the isolation case of the sign context names the document, the version and the signature of an answer, and shows a person only what is theirs in their own tenant', () => {
  const context = (signature: unknown) => ({
    repository: { githubRepoId: 9001, fullName: 'org-1/scoped', accountLogin: 'org-1' },
    document: { id: 3, name: 'Individual CLA' },
    version: {
      id: 4,
      major: 1,
      minor: 0,
      contentMd: 'Terms',
      contentSha256: 'a'.repeat(64),
      rationale: 'test',
      publishedAt: '2026-11-02T10:00:00.000Z',
    },
    consent: { id: 'individual-v1', text: 'I agree' },
    emails: [],
    viewer: { githubId: 7, login: 'ada' },
    pr: null,
    prUrl: null,
    state: signature === null ? 'ready' : 'already_signed',
    signature,
    revoked: null,
    canSign: false,
    blockedReason: 'no_verified_email',
  });
  const isolation = ISOLATION_CASES['GET /api/sign/:githubRepoId'];
  const signed = { id: 5, major: 1, minor: 0, signedAt: '2026-11-02T10:00:00.000Z' };
  expect(isolation?.rows(context(signed))).toEqual([
    { table: 'cla_documents', id: 3 },
    { table: 'cla_versions', id: 4 },
    { table: 'signatures', id: 5 },
  ]);
  expect(isolation?.rows(context(null))).toEqual([
    { table: 'cla_documents', id: 3 },
    { table: 'cla_versions', id: 4 },
  ]);
  const viewer = {
    userId: 10,
    own: { installationId: 1, repositoryId: 1, documentId: 1, githubRepoId: 1, entryId: 1 },
  };
  expect(isolation?.mayShow({ installationId: 1, userId: null }, viewer)).toBe(true);
  expect(isolation?.mayShow({ installationId: 1, userId: 10 }, viewer)).toBe(true);
  expect(isolation?.mayShow({ installationId: 1, userId: 11 }, viewer)).toBe(false);
  expect(isolation?.mayShow({ installationId: 2, userId: null }, viewer)).toBe(false);
});

test('the isolation case of the sign request names the signature of an answer, asks as the viewer for their own repository, and shows a person only their own signature of their own tenant', () => {
  const isolation = ISOLATION_CASES['POST /api/sign'];
  const answer = {
    signature: { id: 5, versionId: 4, major: 1, minor: 0, signedAt: '2026-11-02T10:00:00.000Z' },
    created: false,
  };
  expect(isolation?.rows(answer)).toEqual([{ table: 'signatures', id: 5 }]);
  const target = { installationId: 1, repositoryId: 1, documentId: 1, githubRepoId: 9001, entryId: 1 };
  const sent = isolation?.request(target, null);
  expect(sent).toMatchObject({
    method: 'POST',
    url: '/api/sign',
    payload: { githubRepoId: 9001, consentTextId: 'individual-v1' },
  });
  expect(sent).toEqual(isolation?.request(target, { ...target, githubRepoId: 18_001 }));
  const viewer = { userId: 10, own: target };
  expect(isolation?.mayShow({ installationId: 1, userId: 10 }, viewer)).toBe(true);
  expect(isolation?.mayShow({ installationId: 1, userId: 11 }, viewer)).toBe(false);
  expect(isolation?.mayShow({ installationId: 2, userId: 10 }, viewer)).toBe(false);
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
