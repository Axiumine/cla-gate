// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { failingAfterSend, sentJobs } from './jobs-fixture/test-support.ts';
import { brokenBy, publishWorld, refuseAudit } from './publish-fixture/test-support.ts';
import { type DisableRequest, disableRepository } from './repository-disablement.ts';

// Turning enforcement off below the routes (E14-S04): the checks the service makes itself under the lock of the repository, and what
// an abort leaves. Tenant 1's plain repository enforces the installation-wide document and is on.

async function world() {
  const base = await publishWorld();
  const { t1 } = base;
  await base.db
    .updateTable('repositories')
    .set({ cla_document_id: t1.documentId, enabled: true })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  const request = (over: Partial<DisableRequest>): DisableRequest => ({
    repositoryId: t1.plain.repositoryId,
    role: 'org_admin',
    actorGithubId: base.people.admin1.githubId,
    ...over,
  });
  const run = (over: Partial<DisableRequest> = {}) =>
    disableRepository(base.db, base.scope, base.enqueuer, request(over));
  const stateOf = (repositoryId: number) =>
    base.db.selectFrom('repositories').select('enabled').where('id', '=', repositoryId).executeTakeFirstOrThrow();
  const audited = () =>
    base.db.selectFrom('audit_log').select('action').where('action', '=', 'repository.disabled').execute();
  return { ...base, run, stateOf, audited };
}

test("an admin of the repository whom the guard let in is refused when the document attached by the time the lock is held is the organisation's", async () => {
  const { t1, db, run, stateOf, audited } = await world();
  await db
    .updateTable('repositories')
    .set({ cla_document_id: t1.documentId, enabled: true })
    .where('id', '=', t1.scoped.repositoryId)
    .execute();
  expect(await brokenBy(run({ repositoryId: t1.scoped.repositoryId, role: 'repo_admin' }))).toEqual({
    rule: 'forbidden',
    details: undefined,
  });
  expect((await stateOf(t1.scoped.repositoryId)).enabled).toBe(true);
  expect(await audited()).toEqual([]);
  expect(await sentJobs(db)).toEqual([]);
});

test("a repository that is not the tenant's, is removed or does not exist is not_found", async () => {
  const { t1, t2, db, run } = await world();
  await db
    .updateTable('repositories')
    .set({ removed_at: new Date('2026-10-01T00:00:00Z') })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  const refused = [
    await brokenBy(run()),
    await brokenBy(run({ repositoryId: t2.plain.repositoryId })),
    await brokenBy(run({ repositoryId: 987_654 })),
  ];
  expect(refused.map((rule) => rule?.rule)).toEqual(['not_found', 'not_found', 'not_found']);
  expect(await sentJobs(db)).toEqual([]);
});

test('a repository with no CLA attached can be turned off: nothing is needed to stop enforcing', async () => {
  const { t1, db, run, stateOf } = await world();
  await db.updateTable('repositories').set({ cla_document_id: null }).where('id', '=', t1.plain.repositoryId).execute();
  expect(await run()).toEqual({ enabled: false, changed: true });
  expect((await stateOf(t1.plain.repositoryId)).enabled).toBe(false);
});

test('a call reports that the repository is off now, and one that asks for what is reports it with changed false and sends nothing more', async () => {
  const { db, run, audited } = await world();
  expect(await run()).toEqual({ enabled: false, changed: true });
  expect(await run()).toEqual({ enabled: false, changed: false });
  expect((await sentJobs(db)).map((sent) => sent.job.type)).toEqual(['finalise-repository']);
  expect(await audited()).toHaveLength(1);
});

test('an audit row that cannot be written aborts the call: the flag stays on and no job is sent', async () => {
  const { t1, db, run, stateOf } = await world();
  await refuseAudit(db);
  await expect(run()).rejects.toThrow('audit refused');
  expect((await stateOf(t1.plain.repositoryId)).enabled).toBe(true);
  expect(await sentJobs(db)).toEqual([]);
});

test('a queue that fails after the send rolls the whole call back, and the retry on a working queue succeeds', async () => {
  const { t1, db, enqueuer, scope, people, run, stateOf, audited } = await world();
  const down = new Error('the queue is down');
  const request = {
    repositoryId: t1.plain.repositoryId,
    role: 'org_admin',
    actorGithubId: people.admin1.githubId,
  } as const;
  await expect(disableRepository(db, scope, failingAfterSend(enqueuer, down), request)).rejects.toBe(down);
  expect([(await stateOf(t1.plain.repositoryId)).enabled, await audited(), await sentJobs(db)]).toEqual([true, [], []]);
  expect(await run()).toEqual({ enabled: false, changed: true });
  expect(await audited()).toHaveLength(1);
});
