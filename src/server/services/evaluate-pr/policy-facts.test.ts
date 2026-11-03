// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import {
  migratedTestDatabase,
  publishVersion,
  seedSignature,
  seedTenant,
  type Tenant,
} from '../../adapters/db/test-support.ts';
import { commitSha } from '../github-pull-contract/test-support.ts';
import { type PolicyScope, readAllowlist, readOverrides, readPolicy } from './policy-facts.ts';
import { readSignatures } from './signature-facts.ts';

// The stored facts the evaluation reads, one by one (E07-S04). Tenant 1 is the one read; tenant 2 is its neighbour, whose
// rows are never returned.

async function facts() {
  const { db } = await migratedTestDatabase();
  const one = await seedTenant(db, 1);
  const two = await seedTenant(db, 2);
  const scopeOf = (tenant: Tenant): PolicyScope => ({
    db,
    installationId: tenant.installationId,
    repositoryId: tenant.repositoryId,
  });
  return { db, one, two, scope: scopeOf(one), scopeOfTwo: scopeOf(two) };
}

test('the policy is the document of the repository and the major version that is active', async () => {
  const { db, one, scope } = await facts();
  expect(await readPolicy(scope, one.documentId)).toEqual({ documentId: one.documentId, activeMajor: 1 });
  const second = await publishVersion(db, one.documentId, one.publisherId, { major: 2, minor: 0, text: 'Version two' });
  await db
    .updateTable('cla_documents')
    .set({ active_version_id: second.id })
    .where('id', '=', one.documentId)
    .execute();
  expect(await readPolicy(scope, one.documentId)).toEqual({ documentId: one.documentId, activeMajor: 2 });
});

test('a repository without a document has no policy, and a document without an active version has none either', async () => {
  const { db, one, scope } = await facts();
  expect(await readPolicy(scope, null)).toBeNull();
  await db.updateTable('cla_documents').set({ active_version_id: null }).where('id', '=', one.documentId).execute();
  expect(await readPolicy(scope, one.documentId)).toBeNull();
});

test('the document of another installation is no policy', async () => {
  const { one, two, scope } = await facts();
  expect(await readPolicy({ ...scope, installationId: one.installationId }, two.documentId)).toBeNull();
});

/** An entry of the allowlist of `tenant`, for the installation or for one repository. */
function entry(tenant: Tenant, kind: 'user' | 'bot', githubId: number, repositoryId: number | null = null) {
  return {
    installation_id: tenant.installationId,
    repository_id: repositoryId,
    kind,
    github_id: githubId,
    created_by: tenant.publisherId,
  };
}

test('the allowlist is the entries of the installation and of the repository, with their scope, and nobody else’s', async () => {
  const { db, one, two, scope } = await facts();
  const other = await db
    .insertInto('repositories')
    .values({
      installation_id: one.installationId,
      github_repo_id: 9001,
      full_name: 'org-1/other',
      cla_document_id: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('allowlist_entries')
    .values([
      entry(one, 'user', 11),
      entry(one, 'bot', 12, one.repositoryId),
      entry(one, 'user', 13, other.id),
      entry(two, 'user', 14),
    ])
    .execute();
  const entries = await readAllowlist(scope);
  expect(entries.map((found) => [found.kind, found.githubId, found.scope])).toEqual([
    ['user', 11, 'installation'],
    ['bot', 12, 'repository'],
  ]);
});

test('the overrides are those of the repository for the SHAs asked, as a map from SHA to id', async () => {
  const { db, one, two, scope } = await facts();
  const note = (tenant: Tenant, sha: string) =>
    db
      .insertInto('commit_overrides')
      .values({
        installation_id: tenant.installationId,
        repository_id: tenant.repositoryId,
        commit_sha: sha,
        created_by: tenant.publisherId,
        reason: 'a note',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
  const mine = await note(one, commitSha(1));
  await note(one, commitSha(3));
  await note(two, commitSha(2));
  expect(await readOverrides(scope, [commitSha(1), commitSha(2)])).toEqual(new Map([[commitSha(1), mine.id]]));
  expect(await readOverrides(scope, [])).toEqual(new Map());
});

test('a signature is found by the numeric id of the person, on the active document, not revoked, with the major it was made under', async () => {
  const { db, one, scope } = await facts();
  const { signatureId } = await seedSignature(db, one, 70);
  const revoked = await seedSignature(db, one, 71);
  await sql`update signatures set revoked_at = now(), revoked_by = ${one.publisherId} where id = ${revoked.signatureId}`.execute(
    db,
  );
  expect(await readSignatures(scope, one.documentId, [70, 71, 72])).toEqual([
    { id: signatureId, githubId: 70, documentId: one.documentId, versionId: one.versionId, major: 1, revoked: false },
  ]);
  expect(await readSignatures(scope, one.documentId, [])).toEqual([]);
});

test('the signatures of another installation, and of another document, are never returned, whoever signed', async () => {
  const { db, one, two, scope } = await facts();
  await seedSignature(db, two, 80);
  expect(await readSignatures(scope, one.documentId, [80])).toEqual([]);
  expect(await readSignatures(scope, two.documentId, [80])).toEqual([]);
});

test('more people than one statement takes are read in several, and every signature found is returned', async () => {
  const { db, one, scope } = await facts();
  const first = await seedSignature(db, one, 70);
  const last = await seedSignature(db, one, 71);
  const strangers = Array.from({ length: 600 }, (_, index) => 10_000 + index);
  const found = await readSignatures(scope, one.documentId, [70, ...strangers, 71]);
  expect(found.map((fact) => fact.id)).toEqual([first.signatureId, last.signatureId]);
});
