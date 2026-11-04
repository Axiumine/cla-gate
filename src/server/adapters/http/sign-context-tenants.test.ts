// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { seedInstant, seedSignatures } from '../../services/export/export-fixture/test-support.ts';
import { tenantChecksums } from '../db/tenant-fixture/test-support.ts';
import { contextOf, loginWithEmails, repoIdOf, signWorld } from './sign-context-fixture/test-support.ts';

// The sign page context across tenants (E13-S02). The route is open to any signed-in person, so the tenant is not chosen by the
// caller: it is the one that holds the repository, and every read after it carries that installation's id. Two tenants are made
// by `seedTenant(db, 1)` and `seedTenant(db, 2)`, each with its own document, version and signer.

const ADA = 1234;
const EMAILS = [{ email: 'ada@example.org', primary: true }];

test('the same viewer gets the document, version and consent of the tenant that holds the repository, and never the other one', async () => {
  const world = await signWorld();
  const ada = await loginWithEmails(world, ADA, EMAILS);
  const first = contextOf(await world.ask(ada, repoIdOf(1)));
  const second = contextOf(await world.ask(ada, repoIdOf(2)));
  expect(first).toMatchObject({
    repository: { githubRepoId: repoIdOf(1), fullName: 'org-1/repo', accountLogin: 'org-1' },
    document: { id: world.t1.documentId },
    version: { id: world.t1.versionId, contentSha256: world.t1.contentSha256 },
  });
  expect(second).toMatchObject({
    repository: { githubRepoId: repoIdOf(2), fullName: 'org-2/repo', accountLogin: 'org-2' },
    document: { id: world.t2.documentId },
    version: { id: world.t2.versionId, contentSha256: world.t2.contentSha256 },
  });
  expect(world.t1.documentId).not.toBe(world.t2.documentId);
  expect(JSON.stringify(first)).not.toContain('org-2');
  expect(JSON.stringify(second)).not.toContain('org-1');
});

test("a signature for tenant 2's document does not turn tenant 1's state into already_signed, and it is not shown there", async () => {
  const world = await signWorld();
  const ada = await loginWithEmails(world, ADA, EMAILS);
  const [signatureId] = await seedSignatures(world.db, world.t2, [{ githubId: ADA, signedAtMs: 0 }]);
  const first = contextOf(await world.ask(ada, repoIdOf(1)));
  expect(first).toMatchObject({ state: 'ready', signature: null, revoked: null });
  expect(JSON.stringify(first)).not.toContain(seedInstant(0).toISOString());
  const second = contextOf(await world.ask(ada, repoIdOf(2)));
  expect(second.state).toBe('already_signed');
  expect(second.signature?.id).toBe(signatureId);
});

test("a revoked signature of tenant 2's document is not the revoked signature of tenant 1's", async () => {
  const world = await signWorld();
  const ada = await loginWithEmails(world, ADA, EMAILS);
  await seedSignatures(world.db, world.t2, [
    { githubId: ADA, signedAtMs: 0, revoked: { afterMs: 1000, byGithubId: 2001, reason: 'signer_request' } },
  ]);
  expect(contextOf(await world.ask(ada, repoIdOf(1))).revoked).toBeNull();
  expect(contextOf(await world.ask(ada, repoIdOf(2))).revoked).not.toBeNull();
});

test("a repository cannot be attached to another tenant's document: the database refuses the pair", async () => {
  const world = await signWorld();
  await expect(
    world.db
      .updateTable('repositories')
      .set({ cla_document_id: world.t2.documentId })
      .where('id', '=', world.t1.repositoryId)
      .execute(),
  ).rejects.toThrow(/repositories_cla_document_fk/u);
});

test('a repository that moved to the other tenant is served from the tenant that holds it now', async () => {
  const world = await signWorld();
  const ada = await loginWithEmails(world, ADA, EMAILS);
  await world.db
    .updateTable('repositories')
    .set({ removed_at: new Date('2026-10-01T00:00:00Z') })
    .where('id', '=', world.t1.repositoryId)
    .execute();
  await world.db
    .insertInto('repositories')
    .values({
      installation_id: world.t2.installationId,
      github_repo_id: repoIdOf(1),
      full_name: 'org-2/moved',
      cla_document_id: world.t2.documentId,
    })
    .execute();
  expect(contextOf(await world.ask(ada, repoIdOf(1)))).toMatchObject({
    repository: { githubRepoId: repoIdOf(1), fullName: 'org-2/moved', accountLogin: 'org-2' },
    document: { id: world.t2.documentId },
  });
});

test('a suspended tenant does not change what the other tenant shows, and asking about it changes no row', async () => {
  const world = await signWorld();
  const ada = await loginWithEmails(world, ADA, EMAILS);
  await world.db
    .updateTable('installations')
    .set({ suspended_at: new Date('2026-10-01T00:00:00Z') })
    .where('id', '=', world.t1.installationId)
    .execute();
  const before = await tenantChecksums(world.db);
  expect((await world.ask(ada, repoIdOf(1))).statusCode).toBe(404);
  expect(contextOf(await world.ask(ada, repoIdOf(2))).document.id).toBe(world.t2.documentId);
  expect(await tenantChecksums(world.db)).toEqual(before);
});
