// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { sentJobs } from './jobs-fixture/test-support.ts';
import { brokenBy, publishWorld, refuseAudit } from './publish-fixture/test-support.ts';
import { changeRepositoryDocument, type DocumentChange } from './repository-document-attach.ts';

// Attaching and detaching a CLA document below the routes (E14-S02): the checks the service makes itself under the lock of the
// repository, which the guard of the route cannot make for it because it decides before the lock is held, and what an abort leaves.

async function world() {
  const base = await publishWorld();
  const { t1 } = base;
  /** A change of the plain repository of tenant 1 by an org admin, unless `over` says otherwise. */
  const change = (over: Partial<DocumentChange>): DocumentChange => ({
    repositoryId: t1.plain.repositoryId,
    role: 'org_admin',
    actorGithubId: base.people.admin1.githubId,
    documentId: t1.documentId,
    ...over,
  });
  const run = (over: Partial<DocumentChange>) =>
    changeRepositoryDocument(base.db, base.scope, base.enqueuer, change(over));
  const stored = (repositoryId: number) =>
    base.db
      .selectFrom('repositories')
      .select('cla_document_id')
      .where('id', '=', repositoryId)
      .executeTakeFirstOrThrow();
  return { ...base, run, stored };
}

test("an admin of the repository whom the guard let in is refused when the document attached by the time the lock is held is the organisation's", async () => {
  const { t1, run, stored } = await world();
  await run({ repositoryId: t1.scoped.repositoryId, documentId: t1.documentId });
  const refused = await brokenBy(run({ repositoryId: t1.scoped.repositoryId, role: 'repo_admin', documentId: null }));
  expect(refused).toEqual({ rule: 'forbidden', details: undefined });
  expect((await stored(t1.scoped.repositoryId)).cla_document_id).toBe(t1.documentId);
});

test("a repository that is not the tenant's, is removed or does not exist is not_found", async () => {
  const { t1, t2, db, run } = await world();
  await db
    .updateTable('repositories')
    .set({ removed_at: new Date('2026-10-01T00:00:00Z') })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  const removed = await brokenBy(run({}));
  const foreign = await brokenBy(run({ repositoryId: t2.plain.repositoryId }));
  const unknown = await brokenBy(run({ repositoryId: 987_654 }));
  expect([removed, foreign, unknown]).toEqual([
    { rule: 'not_found', details: undefined },
    { rule: 'not_found', details: undefined },
    { rule: 'not_found', details: undefined },
  ]);
});

test('a change reports the document the repository enforces now, and a call that asks for what is reports it with changed false', async () => {
  const { t1, run } = await world();
  expect(await run({})).toEqual({ documentId: t1.documentId, changed: true });
  expect(await run({})).toEqual({ documentId: t1.documentId, changed: false });
  expect(await run({ documentId: null })).toEqual({ documentId: null, changed: true });
  expect(await run({ documentId: null })).toEqual({ documentId: null, changed: false });
});

test('an audit row that cannot be written aborts the change: the pointer stays and no job is sent', async () => {
  const { t1, db, run, stored } = await world();
  await refuseAudit(db);
  await expect(run({ repositoryId: t1.scoped.repositoryId })).rejects.toThrow('audit refused');
  expect((await stored(t1.scoped.repositoryId)).cla_document_id).toBeNull();
  expect(await sentJobs(db)).toEqual([]);
});
