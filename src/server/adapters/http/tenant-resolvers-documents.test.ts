// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyRequest } from 'fastify';
import { expect, test } from 'vitest';
import { CLA_TEXT, publishVersion, sha256 } from '../db/test-support.ts';
import { matrixWorld } from './cross-tenant-runner/test-support.ts';
import { AppError } from './errors.ts';
import { type TenantResolver, type TenantTarget, tenantAccess } from './tenant-access.ts';
import { shapeOf } from './tenant-guard-fixture/test-support.ts';
import { byDocumentParam, byRepositoryParam, bySignatureParam } from './tenant-resolvers.ts';

// The resolvers of a document and of a signature (E11-S07): the role follows the scope of the document, and a document of a
// repository that left the installation stays reachable for an org admin only, because nobody's permission on that
// repository can be checked any more. A repository itself that left is a 404 on every repository route.

type Seen = TenantTarget | null | Error;

/** The signature of an outsider on the repo-scoped document of tenant 1, which the fixture does not store. */
async function scopedSignature(world: Awaited<ReturnType<typeof matrixWorld>>): Promise<number> {
  const { t1, people, db } = world;
  const version = await publishVersion(db, t1.scoped.documentId, t1.publisherId, {
    major: 1,
    minor: 0,
    text: CLA_TEXT,
  });
  const signature = await db
    .insertInto('signatures')
    .values({
      installation_id: t1.installationId,
      user_id: people.outsider.userId,
      document_id: t1.scoped.documentId,
      version_id: version.id,
      major: 1,
      content_sha256: sha256(CLA_TEXT),
      consent_text_id: 'consent-v1',
      signer_type: 'individual',
      source_repository_id: t1.scoped.repositoryId,
      source_pr_number: 9,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return signature.id;
}

const DOCUMENT = (installation: number, document: number) => `/installations/${installation}/documents/${document}`;
const SIGNATURE = (installation: number, signature: number) => `/installations/${installation}/signatures/${signature}`;

/** The app with two kinds of routes: `/r/…` answers what the resolver said (and null to the guard), `/h/…` is the real guard and shows `request.tenant`. */
async function world() {
  const matrix = await matrixWorld();
  const { app, db } = matrix;
  const signatureId = await scopedSignature(matrix);
  const seen: Seen[] = [];
  const recording =
    (resolver: TenantResolver): TenantResolver =>
    async (request) => {
      try {
        seen.push(await resolver(request));
      } catch (error) {
        seen.push(error instanceof Error ? error : new Error('not an error'));
      }
      return null;
    };
  const tenantOf = (request: FastifyRequest) => ({ tenant: request.tenant });
  const routes = [
    ['/installations/:installationId/documents/:documentId', byDocumentParam(db)],
    ['/installations/:installationId/signatures/:signatureId', bySignatureParam(db)],
    ['/installations/:installationId/repositories/:repositoryId', byRepositoryParam(db)],
  ] as const;
  for (const [path, resolver] of routes) {
    app.get(
      `/r${path}`,
      { config: { access: tenantAccess({ mode: 'read', resolve: recording(resolver) }) } },
      () => 'x',
    );
    app.get(`/h${path}`, { config: { access: tenantAccess({ mode: 'read', resolve: resolver }) } }, tenantOf);
    app.post(`/h${path}`, { config: { access: tenantAccess({ mode: 'write', resolve: resolver }) } }, tenantOf);
  }
  const resolved = async (url: string): Promise<Seen | undefined> => {
    seen.length = 0;
    await matrix.ask('outsider', { method: 'GET', url: `/r${url}` });
    return seen[0];
  };
  const removeScopedRepository = () =>
    db
      .updateTable('repositories')
      .set({ removed_at: new Date('2026-10-01T00:00:00Z') })
      .where('id', '=', matrix.t1.scoped.repositoryId)
      .execute();
  return { ...matrix, signatureId, resolved, removeScopedRepository };
}

type World = Awaited<ReturnType<typeof world>>;

const orgAdmin = (installationId: TenantTarget['installationId']): TenantTarget => ({
  installationId,
  repositoryId: null,
  requirement: 'org_admin',
});

test('a document that covers the installation needs an org admin and names no repository', async () => {
  const w = await world();
  expect(await w.resolved(DOCUMENT(w.t1.installationId, w.t1.documentId))).toEqual(orgAdmin(w.t1.installationId));
});

test('a document of a repository that is part of the installation needs an admin of that repository', async () => {
  const w = await world();
  expect(await w.resolved(DOCUMENT(w.t1.installationId, w.t1.scoped.documentId))).toEqual({
    installationId: w.t1.installationId,
    repositoryId: w.t1.scoped.repositoryId,
    requirement: 'repo_admin',
  });
});

test('a document of a repository that left the installation needs an org admin and names no repository', async () => {
  const w = await world();
  await w.removeScopedRepository();
  expect(await w.resolved(DOCUMENT(w.t1.installationId, w.t1.scoped.documentId))).toEqual(
    orgAdmin(w.t1.installationId),
  );
});

test('a signature follows the scope of its document, whatever repository it was signed from', async () => {
  const w = await world();
  // The signature of the fixture was signed from the plain repository, under the document that covers the installation.
  expect(await w.resolved(SIGNATURE(w.t1.installationId, w.t1.signatureId))).toEqual(orgAdmin(w.t1.installationId));
  expect(await w.resolved(SIGNATURE(w.t1.installationId, w.signatureId))).toEqual({
    installationId: w.t1.installationId,
    repositoryId: w.t1.scoped.repositoryId,
    requirement: 'repo_admin',
  });
  await w.removeScopedRepository();
  expect(await w.resolved(SIGNATURE(w.t1.installationId, w.signatureId))).toEqual(orgAdmin(w.t1.installationId));
});

test.each([
  ['an unknown document', (w: World) => DOCUMENT(w.t1.installationId, 987_654)],
  ["another tenant's document under this installation", (w: World) => DOCUMENT(w.t1.installationId, w.t2.documentId)],
  ['a document under an unknown installation', () => DOCUMENT(987_654, 1)],
  ['an unknown signature', (w: World) => SIGNATURE(w.t1.installationId, 987_654)],
  [
    "another tenant's signature under this installation",
    (w: World) => SIGNATURE(w.t1.installationId, w.t2.signatureId),
  ],
  ['a signature under an unknown installation', () => SIGNATURE(987_654, 1)],
])('%s resolves to null', async (_name, urlOf) => {
  const w = await world();
  expect(await w.resolved(urlOf(w))).toBeNull();
});

test.each([
  ['a document', 'documents'],
  ['a signature', 'signatures'],
] as const)('%s of a tenant the admission policy rejected resolves to null', async (_name, kind) => {
  const w = await world();
  await w.db
    .updateTable('installations')
    .set({ admission_status: 'rejected', admission_reason: 'policy_changed' })
    .where('id', '=', w.t1.installationId)
    .execute();
  const id = kind === 'documents' ? w.t1.documentId : w.t1.signatureId;
  expect(await w.resolved(`/installations/${w.t1.installationId}/${kind}/${id}`)).toBeNull();
});

test.each([
  ['a document id that is a word', '/installations/1/documents/abc'],
  ['a document id of zero', '/installations/1/documents/0'],
  ['a document id with a leading zero', '/installations/1/documents/01'],
  ['an installation id that is a word beside a document', '/installations/abc/documents/1'],
  ['a signature id with a sign', '/installations/1/signatures/-1'],
  ['a signature id that is a fraction', '/installations/1/signatures/1.5'],
  ['a signature id that no number holds exactly', '/installations/1/signatures/9007199254740993'],
  ['an installation id of zero beside a signature', '/installations/0/signatures/1'],
])('%s is a 400 and reads nothing', async (_name, url) => {
  const w = await world();
  // What a request that only needs the session costs: the lookup of the session and nothing else.
  const start = w.queries.length;
  await w.ask('outsider', { method: 'GET', url: '/probe/protected' });
  const session = w.queries.length - start;
  const before = w.queries.length;
  const answer = await w.resolved(url);
  expect(answer).toBeInstanceOf(AppError);
  expect(answer).toMatchObject({ status: 400, code: 'bad_request' });
  expect(w.queries.length - before).toBe(session);
});

test('a repository that left the installation is a 404 on a repository route, for its org admin too', async () => {
  const w = await world();
  const url = `/h/installations/${w.t1.installationId}/repositories/${w.t1.scoped.repositoryId}`;
  expect((await w.ask('admin1', { method: 'GET', url })).statusCode).toBe(200);
  await w.removeScopedRepository();
  const unknown = shapeOf(
    await w.ask('admin1', { method: 'GET', url: `${url.slice(0, -String(w.t1.scoped.repositoryId).length)}987654` }),
  );
  for (const who of ['admin1', 'repoAdmin1'] as const) {
    expect(shapeOf(await w.ask(who, { method: 'GET', url }))).toEqual(unknown);
  }
});

test.each([
  ['document', (w: World) => DOCUMENT(w.t1.installationId, w.t1.scoped.documentId)],
  ['signature', (w: World) => SIGNATURE(w.t1.installationId, w.signatureId)],
] as const)(
  'the %s of a repository that left stays reachable to an org admin only, for a read and a write alike',
  async (_kind, pathOf) => {
    const w = await world();
    const url = `/h${pathOf(w)}`;
    // While the repository is part of the installation, its admin reaches the document as a repository admin.
    const before = await w.ask('repoAdmin1', { method: 'GET', url });
    expect([before.statusCode, before.json()]).toEqual([
      200,
      { tenant: { installationId: w.t1.installationId, repositoryId: w.t1.scoped.repositoryId, role: 'repo_admin' } },
    ]);
    await w.removeScopedRepository();
    const unknown = shapeOf(
      await w.ask('admin1', { method: 'GET', url: `/h/installations/${w.t1.installationId}/documents/987654` }),
    );
    for (const method of ['GET', 'POST'] as const) {
      const admin = await w.ask('admin1', { method, url });
      expect([admin.statusCode, admin.json()]).toEqual([
        200,
        { tenant: { installationId: w.t1.installationId, repositoryId: null, role: 'org_admin' } },
      ]);
      for (const who of ['repoAdmin1', 'member1', 'outsider', 'admin2'] as const) {
        expect(shapeOf(await w.ask(who, { method, url })), `${method} as ${who}`).toEqual(unknown);
      }
    }
  },
);
