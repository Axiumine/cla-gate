// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { type GithubId, parseGithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import { AuditEntryInvalid } from './audit-entry.ts';
import { createInstallationStore } from './installation-store.ts';
import { RepositoryNotFoundError } from './repository-enabled.ts';
import { listed, repoId, worldOfTwoTenants } from './store-fixture/test-support.ts';
import { ACTOR } from './test-support.ts';

const REMOVED_AT = new Date('2026-06-01T12:00:00Z');

async function audit(db: Kysely<Database>) {
  return await db
    .selectFrom('audit_log')
    .select(['installation_id', 'actor_github_id', 'action', 'subject_type', 'subject_id', 'metadata'])
    .orderBy('id')
    .execute();
}

async function enabledOf(db: Kysely<Database>, installationId: number, githubRepoId: number): Promise<boolean> {
  const row = await db
    .selectFrom('repositories')
    .select('enabled')
    .where('installation_id', '=', installationId)
    .where('github_repo_id', '=', githubRepoId)
    .executeTakeFirstOrThrow();
  return row.enabled;
}

/** Attaches a new CLA document to repository `githubRepoId` of the installation; returns the document id. */
async function attachDocument(db: Kysely<Database>, installationId: number, githubRepoId: number): Promise<number> {
  const document = await db
    .insertInto('cla_documents')
    .values({
      installation_id: installationId,
      repository_id: null,
      name: 'CLA',
      kind: 'individual',
      active_version_id: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .updateTable('repositories')
    .set({ cla_document_id: document.id })
    .where('installation_id', '=', installationId)
    .where('github_repo_id', '=', githubRepoId)
    .execute();
  return document.id;
}

async function repositoryIdOf(db: Kysely<Database>, installationId: number, githubRepoId: number): Promise<number> {
  const row = await db
    .selectFrom('repositories')
    .select('id')
    .where('installation_id', '=', installationId)
    .where('github_repo_id', '=', githubRepoId)
    .executeTakeFirstOrThrow();
  return row.id;
}

test('enabling turns the flag on and appends one audit row naming the repository, the document and the actor', async () => {
  const { db, store, a } = await worldOfTwoTenants();
  const documentId = await attachDocument(db, a.installation.id, repoId(1, 1));
  const result = await store.setRepositoryEnabled(a.installation.id, repoId(1, 1), true, ACTOR);
  expect(result).toEqual({ changed: true });
  expect(await enabledOf(db, a.installation.id, repoId(1, 1))).toBe(true);
  expect(await audit(db)).toEqual([
    {
      installation_id: a.installation.id,
      actor_github_id: ACTOR,
      action: 'repository.enabled',
      subject_type: 'repository',
      subject_id: repoId(1, 1),
      metadata: { repository_id: await repositoryIdOf(db, a.installation.id, repoId(1, 1)), document_id: documentId },
    },
  ]);
});

test('enabling a repository without a document records that there is none', async () => {
  const { db, store, a } = await worldOfTwoTenants();
  await store.setRepositoryEnabled(a.installation.id, repoId(1, 1), true, ACTOR);
  const rows = await audit(db);
  expect(rows.map((row) => row.metadata)).toEqual([
    { repository_id: await repositoryIdOf(db, a.installation.id, repoId(1, 1)), document_id: null },
  ]);
});

test('disabling turns the flag off and appends repository.disabled without a document id', async () => {
  const { db, store, a } = await worldOfTwoTenants();
  await attachDocument(db, a.installation.id, repoId(1, 1));
  await store.setRepositoryEnabled(a.installation.id, repoId(1, 1), true, ACTOR);
  const other = parseGithubId(77_777);
  expect(await store.setRepositoryEnabled(a.installation.id, repoId(1, 1), false, other)).toEqual({ changed: true });
  expect(await enabledOf(db, a.installation.id, repoId(1, 1))).toBe(false);
  expect((await audit(db)).at(-1)).toEqual({
    installation_id: a.installation.id,
    actor_github_id: other,
    action: 'repository.disabled',
    subject_type: 'repository',
    subject_id: repoId(1, 1),
    metadata: { repository_id: await repositoryIdOf(db, a.installation.id, repoId(1, 1)) },
  });
});

test.each([
  ['enabling an enabled repository', true],
  ['disabling a repository that is already off', false],
])('%s changes nothing and writes no audit row', async (_name, enabled) => {
  const { db, store, a } = await worldOfTwoTenants();
  if (enabled) {
    await store.setRepositoryEnabled(a.installation.id, repoId(1, 1), true, ACTOR);
  }
  const rowsBefore = (await audit(db)).length;
  const before = await db
    .selectFrom('repositories')
    .selectAll()
    .where('github_repo_id', '=', repoId(1, 1))
    .executeTakeFirstOrThrow();
  expect(await store.setRepositoryEnabled(a.installation.id, repoId(1, 1), enabled, ACTOR)).toEqual({ changed: false });
  expect(await audit(db)).toHaveLength(rowsBefore);
  const after = await db
    .selectFrom('repositories')
    .selectAll()
    .where('github_repo_id', '=', repoId(1, 1))
    .executeTakeFirstOrThrow();
  expect(after).toEqual(before);
});

test('two concurrent enablings change the repository once and write one audit row', async () => {
  const { db, store, a } = await worldOfTwoTenants();
  const results = await Promise.all([
    store.setRepositoryEnabled(a.installation.id, repoId(1, 1), true, ACTOR),
    store.setRepositoryEnabled(a.installation.id, repoId(1, 1), true, ACTOR),
  ]);
  expect(results.filter((result) => result.changed)).toHaveLength(1);
  expect(await audit(db)).toHaveLength(1);
});

test.each([
  ['a removed repository', 1],
  ['a repository the installation does not hold', 99],
])('%s raises RepositoryNotFoundError and writes nothing', async (_name, index) => {
  const { db, store, a } = await worldOfTwoTenants();
  await store.markRepositoriesRemoved(a.installation.id, [repoId(1, 1)], REMOVED_AT);
  const before = await db.selectFrom('repositories').selectAll().orderBy('id').execute();
  for (const enabled of [true, false]) {
    await expect(store.setRepositoryEnabled(a.installation.id, repoId(1, index), enabled, ACTOR)).rejects.toThrow(
      RepositoryNotFoundError,
    );
  }
  expect(await db.selectFrom('repositories').selectAll().orderBy('id').execute()).toEqual(before);
  expect(await audit(db)).toEqual([]);
});

test('the error carries a fixed message and no name, id or number', async () => {
  const { store, a } = await worldOfTwoTenants();
  const failure = await store
    .setRepositoryEnabled(a.installation.id, repoId(1, 99), true, ACTOR)
    .catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(RepositoryNotFoundError);
  expect(String(failure)).toBe('RepositoryNotFoundError: repository not found for this installation');
});

test('a repository brought back after its removal can be enabled again', async () => {
  const { store, a } = await worldOfTwoTenants();
  await store.markRepositoriesRemoved(a.installation.id, [repoId(1, 1)], REMOVED_AT);
  await store.upsertRepositories(a.installation.id, [listed(1, 1)]);
  expect(await store.setRepositoryEnabled(a.installation.id, repoId(1, 1), true, ACTOR)).toEqual({ changed: true });
});

test('inside the caller transaction the update and the audit row roll back together', async () => {
  const { db, a } = await worldOfTwoTenants();
  const outcome = db.transaction().execute(async (trx) => {
    const result = await createInstallationStore(trx).setRepositoryEnabled(
      a.installation.id,
      repoId(1, 1),
      true,
      ACTOR,
    );
    expect(result).toEqual({ changed: true });
    throw new Error('the caller gave up');
  });
  await expect(outcome).rejects.toThrow('the caller gave up');
  expect(await enabledOf(db, a.installation.id, repoId(1, 1))).toBe(false);
  expect(await audit(db)).toEqual([]);
});

test('inside the caller transaction the change is visible to the caller and committed with it', async () => {
  const { db, a } = await worldOfTwoTenants();
  await db.transaction().execute(async (trx) => {
    await createInstallationStore(trx).setRepositoryEnabled(a.installation.id, repoId(1, 1), true, ACTOR);
    expect(await enabledOf(trx, a.installation.id, repoId(1, 1))).toBe(true);
  });
  expect(await enabledOf(db, a.installation.id, repoId(1, 1))).toBe(true);
  expect(await audit(db)).toHaveLength(1);
});

test('when the audit row cannot be written the flag is not changed either', async () => {
  const { db, store, a } = await worldOfTwoTenants();
  await sql`
    create function refuse_audit() returns trigger language plpgsql as $$
    begin raise exception 'audit is down' using errcode = 'P0001'; end $$`.execute(db);
  await sql`create trigger refuse_audit before insert on audit_log for each row execute function refuse_audit()`.execute(
    db,
  );
  await expect(store.setRepositoryEnabled(a.installation.id, repoId(1, 1), true, ACTOR)).rejects.toMatchObject({
    code: 'P0001',
  });
  expect(await enabledOf(db, a.installation.id, repoId(1, 1))).toBe(false);
});

test('A cannot turn B repository on or off, and B rows and audit stay as they were', async () => {
  const { db, store, a, b } = await worldOfTwoTenants();
  await store.setRepositoryEnabled(b.installation.id, b.repoIds[0], true, ACTOR);
  const before = await db
    .selectFrom('repositories')
    .selectAll()
    .where('installation_id', '=', b.installation.id)
    .orderBy('id')
    .execute();
  const auditBefore = await audit(db);
  for (const enabled of [true, false]) {
    await expect(store.setRepositoryEnabled(a.installation.id, b.repoIds[0], enabled, ACTOR)).rejects.toThrow(
      RepositoryNotFoundError,
    );
  }
  expect(
    await db
      .selectFrom('repositories')
      .selectAll()
      .where('installation_id', '=', b.installation.id)
      .orderBy('id')
      .execute(),
  ).toEqual(before);
  expect(await audit(db)).toEqual(auditBefore);
});

test('an audit row is written under the tenant that changed, never under the other one', async () => {
  const { db, store, a, b } = await worldOfTwoTenants();
  await store.setRepositoryEnabled(a.installation.id, a.repoIds[0], true, ACTOR);
  await store.setRepositoryEnabled(b.installation.id, b.repoIds[0], true, ACTOR);
  const rows = await audit(db);
  expect(rows.map((row) => [row.installation_id, row.subject_id])).toEqual([
    [a.installation.id, a.repoIds[0]],
    [b.installation.id, b.repoIds[0]],
  ]);
});

test('a call without a real actor is refused by the audit contract and changes nothing', async () => {
  const { db, store, a } = await worldOfTwoTenants();
  // Plain JavaScript, or a value that came from outside, can hand over what the type forbids.
  const nobody = z.custom<GithubId>().parse(null);
  await expect(store.setRepositoryEnabled(a.installation.id, repoId(1, 1), true, nobody)).rejects.toThrow(
    AuditEntryInvalid,
  );
  expect(await enabledOf(db, a.installation.id, repoId(1, 1))).toBe(false);
  expect(await audit(db)).toEqual([]);
});
