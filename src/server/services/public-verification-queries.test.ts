// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { twoTenants } from '../adapters/db/tenant-fixture/test-support.ts';
import { migratedTestDatabase, publishVersion, seedSignature } from '../adapters/db/test-support.ts';
import { findPublicRepository, hasCountingSignature } from './public-verification-queries.ts';

// The statements of the public signature check (E22-S02). `findPublicRepository` is the one that meets every tenant by design: the
// public call names a repository by GitHub's id and nothing else, so it is pinned here (the registry of E11-S06 names this file).
// `hasCountingSignature` takes the installation id of the repository found, and the tenant matrix of the registry calls it for two tenants.

const world = async () => {
  const { db } = await migratedTestDatabase();
  const tenants = await twoTenants(db);
  return { db, ...tenants };
};

test('findPublicRepository finds the active repository by its GitHub id, whichever tenant holds it, with its flags and the state of its installation', async () => {
  const { db, t1, t2 } = await world();
  await db
    .updateTable('repositories')
    .set({ cla_document_id: t1.documentId, public_verification: true })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  expect(await findPublicRepository(db, t1.plain.githubRepoId)).toEqual({
    installationId: t1.installationId,
    githubInstallationId: t1.githubInstallationId,
    enabled: false,
    publicVerification: true,
    claDocumentId: t1.documentId,
    admissionStatus: 'admitted',
    suspendedAt: null,
    deletedAt: null,
  });
  expect(await findPublicRepository(db, t2.scoped.githubRepoId)).toMatchObject({
    installationId: t2.installationId,
    enabled: true,
    publicVerification: false,
    claDocumentId: null,
  });
});

test('findPublicRepository answers the state of a suspended, uninstalled or rejected installation, and the opt-in is off until somebody turns it on', async () => {
  const { db, t1 } = await world();
  expect((await findPublicRepository(db, t1.plain.githubRepoId))?.publicVerification).toBe(false);
  const away = new Date('2026-10-01T00:00:00Z');
  await db
    .updateTable('installations')
    .set({ suspended_at: away, deleted_at: away, admission_status: 'rejected', admission_reason: 'policy_changed' })
    .where('id', '=', t1.installationId)
    .execute();
  expect(await findPublicRepository(db, t1.plain.githubRepoId)).toMatchObject({
    admissionStatus: 'rejected',
    suspendedAt: away,
    deletedAt: away,
  });
});

test('findPublicRepository finds no repository that is unknown or removed, and the active one when the same id was removed elsewhere', async () => {
  const { db, t1, t2 } = await world();
  expect(await findPublicRepository(db, parseGithubId(987_654))).toBeNull();
  await db
    .updateTable('repositories')
    .set({ removed_at: new Date('2026-10-01T00:00:00Z') })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  expect(await findPublicRepository(db, t1.plain.githubRepoId)).toBeNull();
  await db
    .insertInto('repositories')
    .values({ installation_id: t2.installationId, github_repo_id: t1.plain.githubRepoId, full_name: 'org-2/moved' })
    .execute();
  expect((await findPublicRepository(db, t1.plain.githubRepoId))?.installationId).toBe(t2.installationId);
});

const subject = (documentId: number, githubId: number) => ({ documentId, githubId: parseGithubId(githubId) });

test('hasCountingSignature is true for the signer of the document at the active major, and false for a person who signed nothing', async () => {
  const { db, t1 } = await world();
  const scope = { installationId: t1.installationId };
  expect(await hasCountingSignature(db, scope, subject(t1.documentId, t1.signer.githubId))).toBe(true);
  expect(await hasCountingSignature(db, scope, subject(t1.documentId, 5_000_001))).toBe(false);
});

test('hasCountingSignature finds the person by the numeric id and by nothing else: a user row that has the login but another id is nobody', async () => {
  const { db, t1 } = await world();
  const scope = { installationId: t1.installationId };
  await db.updateTable('users').set({ login: 'renamed' }).where('id', '=', t1.signer.userId).execute();
  expect(await hasCountingSignature(db, scope, subject(t1.documentId, t1.signer.githubId))).toBe(true);
  expect(await hasCountingSignature(db, scope, subject(t1.documentId, t1.signer.githubId + 1))).toBe(false);
});

test('hasCountingSignature is false for a revoked signature', async () => {
  const { db, t1 } = await world();
  await db
    .updateTable('signatures')
    .set({ revoked_at: new Date(), revoked_by: t1.publisherId, revoke_reason: 'maintainer_decision' })
    .where('id', '=', t1.signatureId)
    .execute();
  expect(
    await hasCountingSignature(db, { installationId: t1.installationId }, subject(t1.documentId, t1.signer.githubId)),
  ).toBe(false);
});

test('hasCountingSignature is false for a signature of an older major, and true again for one at the new major', async () => {
  const { db, t1 } = await world();
  const scope = { installationId: t1.installationId };
  const second = await publishVersion(db, t1.documentId, t1.publisherId, { major: 2, minor: 0, text: 'Second terms' });
  await db.updateTable('cla_documents').set({ active_version_id: second.id }).where('id', '=', t1.documentId).execute();
  expect(await hasCountingSignature(db, scope, subject(t1.documentId, t1.signer.githubId))).toBe(false);
  await db
    .insertInto('signatures')
    .values({
      installation_id: t1.installationId,
      user_id: t1.signer.userId,
      document_id: t1.documentId,
      version_id: second.id,
      major: 2,
      content_sha256: (
        await db
          .selectFrom('cla_versions')
          .select('content_sha256')
          .where('id', '=', second.id)
          .executeTakeFirstOrThrow()
      ).content_sha256,
      consent_text_id: 'consent-v1',
      signer_type: 'individual',
    })
    .execute();
  expect(await hasCountingSignature(db, scope, subject(t1.documentId, t1.signer.githubId))).toBe(true);
});

test('hasCountingSignature counts the minor of the active major as the same consent, and a later minor changes nothing', async () => {
  const { db, t1 } = await world();
  const minor = await publishVersion(db, t1.documentId, t1.publisherId, {
    major: 1,
    minor: 1,
    text: 'Same major, new minor',
  });
  await db.updateTable('cla_documents').set({ active_version_id: minor.id }).where('id', '=', t1.documentId).execute();
  expect(
    await hasCountingSignature(db, { installationId: t1.installationId }, subject(t1.documentId, t1.signer.githubId)),
  ).toBe(true);
});

test('hasCountingSignature is false for a document with no active version', async () => {
  const { db, t1 } = await world();
  await db.updateTable('cla_documents').set({ active_version_id: null }).where('id', '=', t1.documentId).execute();
  expect(
    await hasCountingSignature(db, { installationId: t1.installationId }, subject(t1.documentId, t1.signer.githubId)),
  ).toBe(false);
});

test('hasCountingSignature does not count a corporate signature: only an individual one is a person signing for themselves', async () => {
  const { db, t1 } = await world();
  const scope = { installationId: t1.installationId };
  const corporate = await db
    .insertInto('cla_documents')
    .values({
      installation_id: t1.installationId,
      repository_id: null,
      name: 'Corporate CLA',
      kind: 'corporate',
      active_version_id: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const version = await publishVersion(db, corporate.id, t1.publisherId, {
    major: 1,
    minor: 0,
    text: 'Corporate terms',
  });
  await db.updateTable('cla_documents').set({ active_version_id: version.id }).where('id', '=', corporate.id).execute();
  const stored = await db
    .selectFrom('cla_versions')
    .select('content_sha256')
    .where('id', '=', version.id)
    .executeTakeFirstOrThrow();
  await db
    .insertInto('signatures')
    .values({
      installation_id: t1.installationId,
      user_id: t1.signer.userId,
      document_id: corporate.id,
      version_id: version.id,
      major: 1,
      content_sha256: stored.content_sha256,
      consent_text_id: 'consent-v1',
      signer_type: 'corporate',
    })
    .execute();
  expect(await hasCountingSignature(db, scope, subject(corporate.id, t1.signer.githubId))).toBe(false);
});

test("hasCountingSignature never reads another tenant's rows: the same person and document of the other tenant answer false for this scope", async () => {
  const { db, t1, t2 } = await world();
  const scope = { installationId: t1.installationId };
  expect(await hasCountingSignature(db, scope, subject(t2.documentId, t2.signer.githubId))).toBe(false);
  expect(await hasCountingSignature(db, scope, subject(t1.documentId, t2.signer.githubId))).toBe(false);
  expect(await hasCountingSignature(db, scope, subject(t2.documentId, t1.signer.githubId))).toBe(false);
  const other = await seedSignature(db, t2, 6_000_001);
  expect(other.signatureId).toBeGreaterThan(0);
  expect(await hasCountingSignature(db, scope, subject(t1.documentId, 6_000_001))).toBe(false);
  expect(await hasCountingSignature(db, { installationId: t2.installationId }, subject(t2.documentId, 6_000_001))).toBe(
    true,
  );
});
