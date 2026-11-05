// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { publishVersion, sha256 } from '../adapters/db/test-support.ts';
import { scopeDocuments } from './discovery-fixture/test-support.ts';
import { seedSignatures } from './export/export-fixture/test-support.ts';
import { id } from './github-contract/test-support.ts';
import { GitHubUnavailableError } from './ports/github-errors.ts';
import { recordingLookup } from './recording-lookup-fixture/test-support.ts';
import { VIEWER } from './role-fixture/test-support.ts';
import { type SignatureSearchRequest, searchSignatures } from './signature-search.ts';
import { searchableDocuments } from './signature-search-scope.ts';
import { worldOfTwoTenants } from './store-fixture/test-support.ts';

// Which documents a search may read, below the HTTP layer (E15-S02): what an org admin and a repository admin are given, how many
// repositories a search asks the lookups about, and what a lookup that fails does. The lookup is a stand-in that says what it is told
// to, and records every repository it was asked about.

const EVERYTHING: SignatureSearchRequest = {
  documentId: null,
  state: 'all',
  githubUserId: null,
  login: null,
  limit: 100,
  from: null,
};

const nameOf = (n: number, index: number): string => `org-${n}/repo-${String(index).padStart(3, '0')}`;

type World = Awaited<ReturnType<typeof worldOfTwoTenants>>;

/**
 * Stores `repo-<index>` of tenant `n` for each index, each with a repo-scoped document that has one signature, `publisherId` being
 * who published its version; returns the ids of the documents by repository name.
 */
async function signedDocuments(world: World, publisherId: number, n: 1 | 2, indexes: readonly number[]) {
  const tenant = n === 1 ? world.a : world.b;
  const names = indexes.map((index) => nameOf(n, index));
  await world.store.upsertRepositories(
    tenant.installation.id,
    indexes.map((index) => ({ githubRepoId: id(n * 10_000 + index), fullName: nameOf(n, index) })),
  );
  await scopeDocuments(world.db, tenant.installation.id, names);
  const documents = await world.db
    .selectFrom('cla_documents as d')
    .innerJoin('repositories as r', 'r.id', 'd.repository_id')
    .select(['d.id as documentId', 'r.id as repositoryId', 'r.full_name as fullName'])
    .where('d.installation_id', '=', tenant.installation.id)
    .where('r.full_name', 'in', names)
    .orderBy('r.id')
    .execute();
  const byName = new Map<string, number>();
  for (const [position, document] of documents.entries()) {
    const version = await publishVersion(world.db, document.documentId, publisherId, {
      major: 1,
      minor: 0,
      text: 'terms',
    });
    const target = {
      installationId: tenant.installation.id,
      documentId: document.documentId,
      versionId: version.id,
      contentSha256: sha256('terms'),
      repositoryId: document.repositoryId,
    };
    await seedSignatures(world.db, target, [{ githubId: 100_000 + n * 1000 + position }]);
    byName.set(document.fullName, document.documentId);
  }
  return byName;
}

async function setup(administered: ReadonlySet<string> | 'all' = 'all') {
  const world = await worldOfTwoTenants();
  const recorder = recordingLookup(administered);
  const publisher = await world.db
    .insertInto('users')
    .values({ github_id: 9_999_001, login: 'publisher', name: null, avatar_url: null })
    .returning('id')
    .executeTakeFirstOrThrow();
  const forTenant = (tenant: typeof world.a, role: 'org_admin' | 'repo_admin') => ({
    installationId: tenant.installation.id,
    role,
  });
  const signed = (n: 1 | 2, indexes: readonly number[]) => signedDocuments(world, publisher.id, n, indexes);
  return { ...world, ...recorder, deps: { db: world.db, lookup: recorder.lookup }, forTenant, signed };
}

test('an org admin is given every document of the installation and no lookup of any permission is made', async () => {
  const { asked, deps, forTenant, a, signed } = await setup();
  await signed(1, [3, 4]);
  expect(await searchableDocuments(deps, forTenant(a, 'org_admin'), VIEWER, null)).toEqual({
    documentIds: null,
    truncated: false,
  });
  expect(asked).toEqual([]);
});

test('an org admin who names a document of the installation is given that document alone, and any other id is none', async () => {
  const { asked, deps, forTenant, a, signed } = await setup();
  const documents = await signed(1, [3]);
  const documentId = documents.get(nameOf(1, 3)) ?? 0;
  expect(await searchableDocuments(deps, forTenant(a, 'org_admin'), VIEWER, documentId)).toEqual({
    documentIds: [documentId],
    truncated: false,
  });
  expect(await searchableDocuments(deps, forTenant(a, 'org_admin'), VIEWER, documentId + 1000)).toBeNull();
  expect(asked).toEqual([]);
});

test('a document of another tenant is none for an org admin and for a repository admin, and no lookup is made for it', async () => {
  const { asked, deps, forTenant, a, signed } = await setup();
  const [foreign] = (await signed(2, [3])).values();
  expect(await searchableDocuments(deps, forTenant(a, 'org_admin'), VIEWER, foreign ?? 0)).toBeNull();
  expect(await searchableDocuments(deps, forTenant(a, 'repo_admin'), VIEWER, foreign ?? 0)).toBeNull();
  expect(asked).toEqual([]);
});

test('a repository admin is given the documents of the repositories the lookup confirms, and only repositories with a signed document are asked about', async () => {
  const { asked, deps, forTenant, a, db, signed } = await setup(new Set([nameOf(1, 4)]));
  const documents = await signed(1, [3, 4]);
  await scopeDocuments(db, a.installation.id, ['org-1/repo-1'], ['Unsigned CLA']);
  const scope = await searchableDocuments(deps, forTenant(a, 'repo_admin'), VIEWER, null);
  expect(scope).toEqual({ documentIds: [documents.get(nameOf(1, 4))], truncated: false });
  expect(asked.map((call) => call.fullName)).toEqual([nameOf(1, 3), nameOf(1, 4)]);
  expect(asked.map((call) => [call.installation, call.githubInstallationId, call.githubRepoId])).toEqual([
    [a.installation.id, 100, 10_003],
    [a.installation.id, 100, 10_004],
  ]);
});

test('a repository admin who administers none is given no documents, which is an empty list and not every document', async () => {
  const { deps, forTenant, a, signed } = await setup(new Set());
  await signed(1, [3]);
  expect(await searchableDocuments(deps, forTenant(a, 'repo_admin'), VIEWER, null)).toEqual({
    documentIds: [],
    truncated: false,
  });
});

test('a repository admin is asked about at most 50 repositories, and the search says it was cut when more had signatures', async () => {
  const { asked, deps, forTenant, a, signed } = await setup();
  const documents = await signed(
    1,
    Array.from({ length: 60 }, (_unused, index) => index + 3),
  );
  const scope = await searchableDocuments(deps, forTenant(a, 'repo_admin'), VIEWER, null);
  expect(asked).toHaveLength(50);
  expect(scope?.truncated).toBe(true);
  expect(scope?.documentIds).toEqual([...documents.values()].slice(0, 50));
});

test('exactly 50 repositories with signatures are all asked about and the search is not cut', async () => {
  const { asked, deps, forTenant, a, signed } = await setup();
  await signed(
    1,
    Array.from({ length: 50 }, (_unused, index) => index + 3),
  );
  const scope = await searchableDocuments(deps, forTenant(a, 'repo_admin'), VIEWER, null);
  expect([asked.length, scope?.truncated, scope?.documentIds?.length]).toEqual([50, false, 50]);
});

test('a repository admin of a repository beyond the 50 reaches its document by naming it: one lookup, not fifty', async () => {
  const { asked, deps, forTenant, a, signed } = await setup(new Set([nameOf(1, 62)]));
  const documents = await signed(
    1,
    Array.from({ length: 60 }, (_unused, index) => index + 3),
  );
  const scope = await searchableDocuments(deps, forTenant(a, 'repo_admin'), VIEWER, documents.get(nameOf(1, 62)) ?? 0);
  expect(scope).toEqual({ documentIds: [documents.get(nameOf(1, 62))], truncated: false });
  expect(asked.map((call) => call.fullName)).toEqual([nameOf(1, 62)]);
  expect(
    await searchableDocuments(deps, forTenant(a, 'repo_admin'), VIEWER, documents.get(nameOf(1, 10)) ?? 0),
  ).toBeNull();
});

test('a repository admin who names the installation document, a document of a removed repository or an unknown one is told none, with no lookup', async () => {
  const { asked, db, deps, forTenant, a, signed } = await setup();
  const documents = await signed(1, [3]);
  const installationDocument = await db
    .insertInto('cla_documents')
    .values({
      installation_id: a.installation.id,
      repository_id: null,
      name: 'Installation CLA',
      kind: 'individual',
      active_version_id: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db.updateTable('repositories').set({ removed_at: new Date() }).where('full_name', '=', nameOf(1, 3)).execute();
  for (const documentId of [installationDocument.id, documents.get(nameOf(1, 3)) ?? 0, 987_654]) {
    expect(await searchableDocuments(deps, forTenant(a, 'repo_admin'), VIEWER, documentId)).toBeNull();
  }
  expect(await searchableDocuments(deps, forTenant(a, 'repo_admin'), VIEWER, null)).toEqual({
    documentIds: [],
    truncated: false,
  });
  expect(asked).toEqual([]);
});

test('an org admin still reaches the document of a repository that was removed', async () => {
  const { db, deps, forTenant, a, signed } = await setup();
  const documents = await signed(1, [3]);
  await db.updateTable('repositories').set({ removed_at: new Date() }).where('full_name', '=', nameOf(1, 3)).execute();
  const documentId = documents.get(nameOf(1, 3)) ?? 0;
  expect(await searchableDocuments(deps, forTenant(a, 'org_admin'), VIEWER, documentId)).toEqual({
    documentIds: [documentId],
    truncated: false,
  });
});

test('the lookups of a search run five at a time', async () => {
  const { deps, forTenant, a, signed, state } = await setup();
  await signed(
    1,
    Array.from({ length: 30 }, (_unused, index) => index + 3),
  );
  await searchableDocuments(deps, forTenant(a, 'repo_admin'), VIEWER, null);
  expect(state.mostRunning).toBe(5);
});

test('a lookup that fails fails the search, named document or not: it is never a search of none', async () => {
  const { db, forTenant, a, signed } = await setup();
  const documents = await signed(1, [3]);
  const deps = { db, lookup: () => Promise.reject(new GitHubUnavailableError('down')) };
  const named = documents.get(nameOf(1, 3)) ?? 0;
  await expect(searchSignatures(deps, forTenant(a, 'repo_admin'), VIEWER, EVERYTHING)).rejects.toBeInstanceOf(
    GitHubUnavailableError,
  );
  await expect(
    searchSignatures(deps, forTenant(a, 'repo_admin'), VIEWER, { ...EVERYTHING, documentId: named }),
  ).rejects.toBeInstanceOf(GitHubUnavailableError);
});

test('a search of a repository admin reads the signatures of the confirmed documents only, and says when it was cut', async () => {
  const { deps, forTenant, a, signed } = await setup(new Set([nameOf(1, 5), nameOf(1, 70)]));
  const documents = await signed(
    1,
    Array.from({ length: 70 }, (_unused, index) => index + 3),
  );
  const page = await searchSignatures(deps, forTenant(a, 'repo_admin'), VIEWER, EVERYTHING);
  expect(page?.truncated).toBe(true);
  expect(page?.items.map((item) => item.document.id)).toEqual([documents.get(nameOf(1, 5))]);
  const none = await searchSignatures(
    { ...deps, lookup: () => Promise.resolve(false) },
    forTenant(a, 'repo_admin'),
    VIEWER,
    EVERYTHING,
  );
  expect(none).toEqual({ items: [], next: null, truncated: true });
});
