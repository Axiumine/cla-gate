// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { seedInstant, seedSignatures } from '../../services/export/export-fixture/test-support.ts';
import { tenantChecksums } from '../db/tenant-fixture/test-support.ts';
import { errorCodeOf, idsOf, pageOf, searchWorld, withoutRequestId } from './signature-search-fixture/test-support.ts';

// `GET /api/installations/:installationId/signatures` (E15-S02): who may read it, which documents each role reaches, and what an item
// holds. The filters are in signature-search-filters.test.ts, the pages in signature-search-pages.test.ts, the query string in
// signature-search-query.test.ts, the tenants in signature-search-tenants.test.ts and the hostile names in signature-search-hostile.test.ts.

/**
 * The checksums of the tenant tables but the ledger of org admins: the guard records the admins it sees (E11-S07), for every call
 * of an admin, whatever the route does.
 */
async function withoutLedger(db: Parameters<typeof tenantChecksums>[0]) {
  const all = await tenantChecksums(db);
  return Object.fromEntries(Object.entries(all).filter(([table]) => table !== 'installation_admin_seen'));
}

test('an org admin searches every document of the installation: the signatures of the installation document and of a repository document, newest first', async () => {
  const { db, scopedTarget, search, t1 } = await searchWorld();
  const [scopedId] = await seedSignatures(db, await scopedTarget(), [{ githubId: 71 }]);
  const response = await search('admin1', t1.installationId);
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(pageOf(response)).toMatchObject({ nextCursor: null, truncated: false });
  expect(idsOf(response)).toEqual([t1.signatureId, scopedId]);
});

test('a viewer who is only a repository admin searches the documents scoped to a repository they administer, and never the installation document', async () => {
  const { db, scopedTarget, search, t1 } = await searchWorld();
  const [scopedId] = await seedSignatures(db, await scopedTarget(), [{ githubId: 71 }]);
  expect(idsOf(await search('repoAdmin1', t1.installationId))).toEqual([scopedId]);
  expect(idsOf(await search('repoAdmin1', t1.installationId, `?documentId=${t1.scoped.documentId}`))).toEqual([
    scopedId,
  ]);
});

test('a repository admin whose repositories hold no signature is shown an empty page, not a refusal', async () => {
  const { search, t1 } = await searchWorld();
  expect(pageOf(await search('repoAdmin1', t1.installationId))).toEqual({
    items: [],
    nextCursor: null,
    truncated: false,
  });
});

test.each([
  ['an org admin', 'admin1', 'the installation document', 200],
  ['an org admin', 'admin1', 'the repository document', 200],
  ['a repository admin', 'repoAdmin1', 'the repository document', 200],
  ['a repository admin', 'repoAdmin1', 'the installation document', 404],
] as const)('%s (%s) names %s: %i', async (_role, who, which, status) => {
  const { db, scopedTarget, search, t1 } = await searchWorld();
  await seedSignatures(db, await scopedTarget(), [{ githubId: 71 }]);
  const documentId = which === 'the installation document' ? t1.documentId : t1.scoped.documentId;
  const response = await search(who, t1.installationId, `?documentId=${documentId}`);
  expect(response.statusCode).toBe(status);
  if (status === 404) {
    expect(errorCodeOf(response)).toBe('not_found');
  }
});

test('a repository admin naming a repository document of a repository they do not administer, or an unknown document, is told 404', async () => {
  const { db, search, t1 } = await searchWorld();
  const other = await db
    .insertInto('repositories')
    .values({
      installation_id: t1.installationId,
      github_repo_id: 777_001,
      full_name: 'org-1/other',
      cla_document_id: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const document = await db
    .insertInto('cla_documents')
    .values({
      installation_id: t1.installationId,
      repository_id: other.id,
      name: 'Other CLA',
      kind: 'individual',
      active_version_id: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const foreign = await search('repoAdmin1', t1.installationId, `?documentId=${document.id}`);
  const unknown = await search('repoAdmin1', t1.installationId, '?documentId=987654');
  expect([foreign.statusCode, unknown.statusCode]).toEqual([404, 404]);
  expect(withoutRequestId(foreign)).toBe(withoutRequestId(unknown));
  expect((await search('admin1', t1.installationId, `?documentId=${document.id}`)).statusCode).toBe(200);
});

test('a document of a repository that left the installation is reached by an org admin only, and its repository admin has no role left', async () => {
  const { db, scopedTarget, search, t1 } = await searchWorld();
  const [scopedId] = await seedSignatures(db, await scopedTarget(), [{ githubId: 71 }]);
  await db
    .updateTable('repositories')
    .set({ removed_at: seedInstant(0) })
    .where('id', '=', t1.scoped.repositoryId)
    .execute();
  const named = `?documentId=${t1.scoped.documentId}`;
  expect(idsOf(await search('admin1', t1.installationId, named))).toEqual([scopedId]);
  expect(idsOf(await search('admin1', t1.installationId))).toEqual([t1.signatureId, scopedId]);
  // The repository admin holds no role in the installation any more: the guard reads removed repositories out of the discovery.
  expect((await search('repoAdmin1', t1.installationId, named)).statusCode).toBe(404);
  expect((await search('repoAdmin1', t1.installationId)).statusCode).toBe(404);
});

test('a viewer with no role in the tenant, a person of another tenant and a request with no session are refused alike: 404, 404 and 401', async () => {
  const { search, t1 } = await searchWorld();
  const unknown = await search('admin1', 987_654);
  expect(unknown.statusCode).toBe(404);
  for (const who of ['member1', 'outsider', 'admin2'] as const) {
    const response = await search(who, t1.installationId);
    expect([who, response.statusCode]).toEqual([who, 404]);
    expect(withoutRequestId(response)).toBe(withoutRequestId(unknown));
  }
  expect((await search(null, t1.installationId)).statusCode).toBe(401);
});

test('an item holds the signature, its document and version, where it was signed from and what the signer gave', async () => {
  const { db, search, t1 } = await searchWorld();
  const [id] = await seedSignatures(db, t1, [
    {
      githubId: 71,
      pii: { login: 'Ada-L', name: 'Ada Lovelace', email: 'ada@example.test' },
      signedAtMs: 1500,
      prNumber: 12,
    },
  ]);
  const { items } = pageOf(await search('admin1', t1.installationId, '?githubUserId=71'));
  expect(items).toEqual([
    {
      id,
      githubUserId: 71,
      document: { id: t1.documentId, name: 'Individual CLA' },
      version: { major: 1, minor: 0 },
      signedAt: seedInstant(1500).toISOString(),
      source: { repositoryFullName: 'org-1/repo', prNumber: 12 },
      state: 'active',
      revokedAt: null,
      revokedByGithubId: null,
      revokeReasonCode: null,
      signer: { login: 'Ada-L', name: 'Ada Lovelace', email: 'ada@example.test' },
      piiErased: false,
    },
  ]);
});

test('a signature signed from the dashboard has a source with no pull request, and one with no repository has none', async () => {
  const { db, search, t1 } = await searchWorld();
  await seedSignatures(db, t1, [
    { githubId: 71, signedAtMs: 3000, prNumber: null },
    { githubId: 72, signedAtMs: 2000, repositoryId: null },
  ]);
  const { items } = pageOf(await search('admin1', t1.installationId, '?githubUserId=71'));
  expect(items.map((item) => item.source)).toEqual([{ repositoryFullName: 'org-1/repo', prNumber: null }]);
  const [none] = pageOf(await search('admin1', t1.installationId, '?githubUserId=72')).items;
  expect(none?.source).toBeNull();
});

test('a revoked signature says when, by whom and why, and its state is revoked', async () => {
  const { db, search, t1 } = await searchWorld();
  await seedSignatures(db, t1, [
    { githubId: 71, signedAtMs: 1000, revoked: { afterMs: 5000, byGithubId: 72, reason: 'legal_request' } },
  ]);
  const { items } = pageOf(await search('admin1', t1.installationId, '?githubUserId=71'));
  expect(items).toMatchObject([
    {
      state: 'revoked',
      revokedAt: seedInstant(6000).toISOString(),
      revokedByGithubId: 72,
      revokeReasonCode: 'legal_request',
    },
  ]);
});

test('once the personal data is erased the signer is null and piiErased is true, and the identity key is still there', async () => {
  const { db, search, t1 } = await searchWorld();
  const [id] = await seedSignatures(db, t1, [{ githubId: 71, pii: null }]);
  const response = await search('admin1', t1.installationId, '?githubUserId=71');
  expect(pageOf(response).items).toMatchObject([{ id, githubUserId: 71, signer: null, piiErased: true }]);
  expect(response.json()).toMatchObject({ items: [{ signer: null }] });
});

test('the search is read only: it appends no audit row and changes no row of any tenant table', async () => {
  const { db, scopedTarget, search, t1 } = await searchWorld();
  await seedSignatures(db, await scopedTarget(), [{ githubId: 71 }]);
  const before = await withoutLedger(db);
  const auditBefore = await db.selectFrom('audit_log').select('id').orderBy('id').execute();
  for (const who of ['admin1', 'repoAdmin1', 'member1', 'admin2'] as const) {
    await search(who, t1.installationId, '?login=login-71&state=all');
  }
  expect(await withoutLedger(db)).toEqual(before);
  expect(await db.selectFrom('audit_log').select('id').orderBy('id').execute()).toEqual(auditBefore);
});
