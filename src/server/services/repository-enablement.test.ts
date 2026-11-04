// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { sentJobs } from './jobs-fixture/test-support.ts';
import { brokenBy, publishWorld, refuseAudit } from './publish-fixture/test-support.ts';
import { type EnableRequest, enableRepository } from './repository-enablement.ts';

// Turning enforcement on below the routes (E14-S03): the checks the service makes itself under the lock of the repository, which the
// guard of the route cannot make for it because it decides before the lock is held, and what an abort leaves.

async function world() {
  const base = await publishWorld();
  const { t1 } = base;
  await base.db
    .updateTable('repositories')
    .set({ cla_document_id: t1.documentId })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  /** An enable of the plain repository of tenant 1 by an org admin, unless `over` says otherwise. */
  const request = (over: Partial<EnableRequest>): EnableRequest => ({
    repositoryId: t1.plain.repositoryId,
    role: 'org_admin',
    actorGithubId: base.people.admin1.githubId,
    ...over,
  });
  const run = (over: Partial<EnableRequest> = {}) =>
    enableRepository(base.db, base.scope, base.enqueuer, request(over));
  const enabled = async (repositoryId: number) =>
    (
      await base.db
        .selectFrom('repositories')
        .select('enabled')
        .where('id', '=', repositoryId)
        .executeTakeFirstOrThrow()
    ).enabled;
  return { ...base, run, enabled };
}

test("an admin of the repository whom the guard let in is refused when the document attached by the time the lock is held is the organisation's", async () => {
  const { t1, db, run, enabled } = await world();
  await db
    .updateTable('repositories')
    .set({ cla_document_id: t1.documentId, enabled: false })
    .where('id', '=', t1.scoped.repositoryId)
    .execute();
  const refused = await brokenBy(run({ repositoryId: t1.scoped.repositoryId, role: 'repo_admin' }));
  expect(refused).toEqual({ rule: 'forbidden', details: undefined });
  expect(await enabled(t1.scoped.repositoryId)).toBe(false);
  expect(await sentJobs(db)).toEqual([]);
});

test('the role is judged before the CLA: the admin of a repository with nothing attached is forbidden, not told there is no CLA', async () => {
  const { t1, db, run } = await world();
  await db.updateTable('repositories').set({ enabled: false }).where('id', '=', t1.scoped.repositoryId).execute();
  const refused = await brokenBy(run({ repositoryId: t1.scoped.repositoryId, role: 'repo_admin' }));
  expect(refused?.rule).toBe('forbidden');
  const org = await brokenBy(run({ repositoryId: t1.scoped.repositoryId }));
  expect(org?.rule).toBe('no_active_cla');
});

test("a repository that is not the tenant's, is removed or does not exist is not_found", async () => {
  const { t1, t2, db, run } = await world();
  await db
    .updateTable('repositories')
    .set({ removed_at: new Date('2026-10-01T00:00:00Z') })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  const removed = await brokenBy(run());
  const foreign = await brokenBy(run({ repositoryId: t2.plain.repositoryId }));
  const unknown = await brokenBy(run({ repositoryId: 987_654 }));
  expect([removed, foreign, unknown]).toEqual([
    { rule: 'not_found', details: undefined },
    { rule: 'not_found', details: undefined },
    { rule: 'not_found', details: undefined },
  ]);
});

test('a repository without a CLA to enforce is no_active_cla with the hint that names the fix, and nothing is sent', async () => {
  const { t1, db, run } = await world();
  await db.updateTable('repositories').set({ cla_document_id: null }).where('id', '=', t1.plain.repositoryId).execute();
  const refused = await brokenBy(run());
  expect(refused?.rule).toBe('no_active_cla');
  expect(refused?.details).toEqual({
    hint: 'Attach a CLA document to this repository and publish a version of it first, then enable the repository.',
  });
  expect(await sentJobs(db)).toEqual([]);
});

test('a call reports that the repository enforces now, and one that asks for what is reports it with changed false', async () => {
  const { run } = await world();
  expect(await run()).toEqual({ enabled: true, changed: true });
  expect(await run()).toEqual({ enabled: true, changed: false });
});

test('an audit row that cannot be written aborts the call: the flag stays off and no job is sent', async () => {
  const { t1, db, run, enabled } = await world();
  await refuseAudit(db);
  await expect(run()).rejects.toThrow('audit refused');
  expect(await enabled(t1.plain.repositoryId)).toBe(false);
  expect(await sentJobs(db)).toEqual([]);
});
