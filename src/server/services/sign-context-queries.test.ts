// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { twoTenants } from '../adapters/db/tenant-fixture/test-support.ts';
import { migratedTestDatabase, sha256 } from '../adapters/db/test-support.ts';
import { seedInstant, seedSignatures } from './export/export-fixture/test-support.ts';
import { findSignDocument, findSignRepository, listViewerSignatures } from './sign-context-queries.ts';

// The statements of the sign page context (E13-S02). `findSignRepository` is the one that meets every tenant by design: the sign
// link names a repository by GitHub's id and nothing else, so it is pinned here (the registry of E11-S06 names this file). The
// others take the installation id of the repository found, and the tenant matrix of the registry calls them for two tenants.

/** `expect.any` is typed `any`; as `unknown` it can sit in an object literal. */
const ANY_DATE: unknown = expect.any(Date);

const world = async () => {
  const { db } = await migratedTestDatabase();
  const tenants = await twoTenants(db);
  return { db, ...tenants };
};

test('findSignRepository finds the active repository by its GitHub id, whichever tenant holds it, with the state of its installation', async () => {
  const { db, t1, t2 } = await world();
  expect(await findSignRepository(db, t1.plain.githubRepoId)).toEqual({
    installationId: t1.installationId,
    repositoryId: t1.plain.repositoryId,
    githubRepoId: t1.plain.githubRepoId,
    fullName: 'org-1/repo',
    claDocumentId: null,
    accountLogin: 'org-1',
    admissionStatus: 'admitted',
    suspendedAt: null,
    deletedAt: null,
  });
  expect((await findSignRepository(db, t2.scoped.githubRepoId))?.installationId).toBe(t2.installationId);
});

test('findSignRepository answers the document the repository enforces, and the state of a suspended, uninstalled or rejected installation', async () => {
  const { db, t1 } = await world();
  const away = new Date('2026-10-01T00:00:00Z');
  await db
    .updateTable('repositories')
    .set({ cla_document_id: t1.documentId })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  await db
    .updateTable('installations')
    .set({ suspended_at: away, deleted_at: away, admission_status: 'rejected', admission_reason: 'policy_changed' })
    .where('id', '=', t1.installationId)
    .execute();
  expect(await findSignRepository(db, t1.plain.githubRepoId)).toMatchObject({
    claDocumentId: t1.documentId,
    admissionStatus: 'rejected',
    suspendedAt: away,
    deletedAt: away,
  });
});

test('findSignRepository finds no repository that is unknown or removed, and the active one when the same id was removed elsewhere', async () => {
  const { db, t1, t2 } = await world();
  expect(await findSignRepository(db, 987_654)).toBeNull();
  await db
    .updateTable('repositories')
    .set({ removed_at: new Date('2026-10-01T00:00:00Z') })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  expect(await findSignRepository(db, t1.plain.githubRepoId)).toBeNull();
  await db
    .insertInto('repositories')
    .values({ installation_id: t2.installationId, github_repo_id: t1.plain.githubRepoId, full_name: 'org-2/moved' })
    .execute();
  expect(await findSignRepository(db, t1.plain.githubRepoId)).toMatchObject({
    installationId: t2.installationId,
    fullName: 'org-2/moved',
  });
});

test('findSignDocument reads the document of the tenant with the exact text and numbers of its active version', async () => {
  const { db, t1 } = await world();
  const document = await findSignDocument(db, { installationId: t1.installationId }, t1.documentId);
  expect(document).toEqual({
    id: t1.documentId,
    name: 'Individual CLA',
    kind: 'individual',
    version: {
      id: t1.versionId,
      major: 1,
      minor: 0,
      contentMd: 'I grant the project a perpetual licence to my contributions.',
      contentSha256: t1.contentSha256,
      rationale: 'test',
      publishedAt: ANY_DATE,
    },
  });
});

test('findSignDocument finds nothing for a document of another tenant, an unknown one, or one with no active version', async () => {
  const { db, t1, t2 } = await world();
  const scope = { installationId: t1.installationId };
  expect(await findSignDocument(db, scope, t2.documentId)).toBeNull();
  expect(await findSignDocument(db, scope, 987_654)).toBeNull();
  expect(await findSignDocument(db, scope, t1.scoped.documentId)).toBeNull();
});

test('findSignDocument names the version the document points at, not the newest one', async () => {
  const { db, t1 } = await world();
  await db
    .insertInto('cla_versions')
    .values({
      document_id: t1.documentId,
      major: 2,
      minor: 0,
      content_md: 'Not in force yet',
      content_sha256: sha256('Not in force yet'),
      published_by: t1.signer.userId,
      rationale: 'later',
    })
    .execute();
  expect((await findSignDocument(db, { installationId: t1.installationId }, t1.documentId))?.version.major).toBe(1);
});

test('listViewerSignatures lists the live signatures of the person and the newest revoked one, with the minor of the version signed', async () => {
  const { db, t1 } = await world();
  const second = await db
    .insertInto('cla_versions')
    .values({
      document_id: t1.documentId,
      major: 2,
      minor: 3,
      content_md: 'Version 2.3',
      content_sha256: sha256('Version 2.3'),
      published_by: t1.signer.userId,
      rationale: 'later',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const revoked = { afterMs: 1000, byGithubId: 1001, reason: 'signer_request' } as const;
  const ids = await seedSignatures(db, t1, [
    { githubId: 4242, signedAtMs: 0, revoked },
    { githubId: 4242, signedAtMs: 5000, revoked },
    { githubId: 4242, signedAtMs: 9000, version: { id: second.id, major: 2, sha256: sha256('Version 2.3') } },
    { githubId: 4343, signedAtMs: 1000 },
  ]);
  const user = await db.selectFrom('users').select('id').where('github_id', '=', 4242).executeTakeFirstOrThrow();
  const listed = await listViewerSignatures(db, { installationId: t1.installationId }, user.id, t1.documentId);
  expect(listed).toEqual([
    { id: ids[2], major: 2, minor: 3, signedAt: seedInstant(9000), revokedAt: null },
    { id: ids[1], major: 1, minor: 0, signedAt: seedInstant(5000), revokedAt: seedInstant(6000) },
  ]);
});

test('listViewerSignatures finds nothing for a person who signed nothing, or for a document of another tenant', async () => {
  const { db, t1, t2 } = await world();
  const scope = { installationId: t1.installationId };
  expect(await listViewerSignatures(db, scope, t1.signer.userId, t1.documentId)).toHaveLength(1);
  expect(await listViewerSignatures(db, scope, t1.admin.userId, t1.documentId)).toEqual([]);
  expect(await listViewerSignatures(db, scope, t1.signer.userId, t2.documentId)).toEqual([]);
  expect(await listViewerSignatures(db, scope, t2.signer.userId, t1.documentId)).toEqual([]);
});
