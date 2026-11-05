// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { ERASURES_PATH } from '../../../shared/erasure.ts';
import { HOSTILE_NAMES } from '../../../shared/hostile-names.ts';
import { shaOf } from '../../domain/pending-details-fixture/test-support.ts';
import { failEvaluation } from '../../services/evaluate-pr/evaluation-rows.ts';
import { plainOf } from './commit-override-fixture/test-support.ts';
import { namesOf, pageOf, pendingWorld, storeEvaluations } from './pending-prs-fixture/test-support.ts';

// What makes a pull request pending (E15-S07): the latest evaluation of the pull request, failed, open, in a repository that is on. Each
// case here is one row that must be absent or present, and why.

test('a pull request whose latest evaluation succeeded is absent although an older head SHA failed', async () => {
  const world = await pendingWorld();
  await storeEvaluations(world, plainOf(world.t1), [
    { prNumber: 5, head: 1, result: 'failure', updatedAt: '2026-10-01T10:00:00Z' },
    { prNumber: 5, head: 2, result: 'success', updatedAt: '2026-10-02T10:00:00Z' },
    { prNumber: 6, head: 1, result: 'failure', updatedAt: '2026-10-01T10:00:00Z' },
  ]);
  expect(namesOf(await world.pending('admin1', world.t1.installationId))).toEqual(['org-1/repo#6']);
});

test('a pull request that went back to an older head SHA is judged by the row written last, not by the newest head SHA or the highest id', async () => {
  const world = await pendingWorld();
  // Head 2 was stored last (the higher id) but head 1 was evaluated again afterwards: the row written last decides.
  await storeEvaluations(world, plainOf(world.t1), [
    { prNumber: 5, head: 2, result: 'success', updatedAt: '2026-10-01T10:00:00Z' },
    { prNumber: 5, head: 1, result: 'failure', updatedAt: '2026-10-02T10:00:00Z' },
  ]);
  const { items } = pageOf(await world.pending('admin1', world.t1.installationId));
  expect(items.map((item) => [item.prNumber, item.headSha])).toEqual([[5, shaOf(1)]]);
});

test('a pull request that failed again after a success is listed once, with its latest head SHA', async () => {
  const world = await pendingWorld();
  await storeEvaluations(world, plainOf(world.t1), [
    { prNumber: 5, head: 1, result: 'failure', updatedAt: '2026-10-01T10:00:00Z' },
    { prNumber: 5, head: 2, result: 'success', updatedAt: '2026-10-02T10:00:00Z' },
    { prNumber: 5, head: 3, result: 'failure', updatedAt: '2026-10-03T10:00:00Z' },
  ]);
  const { items } = pageOf(await world.pending('admin1', world.t1.installationId));
  expect(items.map((item) => item.headSha)).toEqual([shaOf(3)]);
});

test('a closed pull request is absent, and it is listed again when it is reopened', async () => {
  const world = await pendingWorld();
  await storeEvaluations(world, plainOf(world.t1), [
    { prNumber: 5, state: 'closed' },
    { prNumber: 6, state: 'open' },
  ]);
  expect(namesOf(await world.pending('admin1', world.t1.installationId))).toEqual(['org-1/repo#6']);
  await world.db
    .updateTable('pr_evaluations')
    .set({ pr_state: 'open' })
    .where('pr_number', '=', 5)
    .where('repository_id', '=', world.t1.plain.repositoryId)
    .execute();
  expect(namesOf(await world.pending('admin1', world.t1.installationId))).toEqual(
    expect.arrayContaining(['org-1/repo#5', 'org-1/repo#6']),
  );
});

test.each(['in_progress', 'success', 'cancelled'] as const)(
  'a pull request whose latest evaluation is %s is not listed',
  async (result) => {
    const world = await pendingWorld();
    await storeEvaluations(world, plainOf(world.t1), [{ prNumber: 5, result, details: {} }]);
    expect(pageOf(await world.pending('admin1', world.t1.installationId)).items).toEqual([]);
  },
);

test('a repository that is switched off, and one that left the installation, have no pending pull requests, and have them again when they are back', async () => {
  const world = await pendingWorld();
  const { db, pending, t1 } = world;
  await storeEvaluations(world, plainOf(t1), [{ prNumber: 5 }]);
  await storeEvaluations(world, { installationId: t1.installationId, repositoryId: t1.scoped.repositoryId }, [
    { prNumber: 6 },
  ]);
  const update = (values: { enabled?: boolean; removed_at?: Date | null }) =>
    db.updateTable('repositories').set(values).where('id', '=', t1.plain.repositoryId).execute();
  await update({ enabled: false });
  expect(namesOf(await pending('admin1', t1.installationId))).toEqual(['org-1/scoped#6']);
  await update({ enabled: true, removed_at: new Date('2026-10-01T00:00:00Z') });
  expect(namesOf(await pending('admin1', t1.installationId))).toEqual(['org-1/scoped#6']);
  await update({ removed_at: null });
  expect(namesOf(await pending('admin1', t1.installationId))).toEqual(expect.arrayContaining(['org-1/repo#5']));
});

test('an unsigned contributor with no users row is listed with login null, and one with a row with the login it holds', async () => {
  const world = await pendingWorld();
  const { db, pending, t1 } = world;
  await db.insertInto('users').values({ github_id: 6001, login: 'seen-login', name: null, avatar_url: null }).execute();
  await storeEvaluations(world, plainOf(t1), [
    { prNumber: 5, details: { codes: ['unsigned_contributor'], actors: [{ githubId: 6001 }, { githubId: 6002 }] } },
  ]);
  const { items } = pageOf(await pending('admin1', t1.installationId));
  expect(items.flatMap((item) => item.reasons)).toEqual([
    { code: 'unsigned_contributor', githubId: 6001, login: 'seen-login' },
    { code: 'unsigned_contributor', githubId: 6002, login: null },
  ]);
});

test('a person erased through the erasure route shows erased-<id> as the login, and the id is still the identity', async () => {
  const world = await pendingWorld();
  const { ask, pending, t1 } = world;
  const signer = t1.signer.githubId;
  await storeEvaluations(world, plainOf(t1), [
    { prNumber: 5, details: { codes: ['unsigned_contributor'], actors: [{ githubId: signer }] } },
  ]);
  expect(pageOf(await pending('admin1', t1.installationId)).items[0]?.reasons).toEqual([
    { code: 'unsigned_contributor', githubId: signer, login: `login-${String(signer)}` },
  ]);
  const erased = await ask('admin1', {
    method: 'POST',
    url: ERASURES_PATH.replace(':installationId', String(t1.installationId)),
    payload: { githubUserId: signer, expectedRows: 1 },
  });
  expect(erased.statusCode).toBe(200);
  expect(pageOf(await pending('admin1', t1.installationId)).items[0]?.reasons).toEqual([
    { code: 'unsigned_contributor', githubId: signer, login: `erased-${String(signer)}` },
  ]);
});

test('a failure the dead-letter handler wrote, with no recognised reason, is listed with the single reason other, and so are details of no known shape', async () => {
  const world = await pendingWorld();
  const { pending, t1 } = world;
  await storeEvaluations(world, plainOf(t1), [
    { prNumber: 5, details: { code: 'evaluation_failed' } },
    { prNumber: 6, details: { code: 'a_code_from_the_future', extra: [1, 2] } },
    { prNumber: 7, details: {} },
    { prNumber: 8, details: { codes: [] } },
  ]);
  const { items } = pageOf(await pending('admin1', t1.installationId, '?limit=10'));
  expect(items.map((item) => [item.prNumber, item.reasons])).toEqual([
    [8, [{ code: 'other' }]],
    [7, [{ code: 'other' }]],
    [6, [{ code: 'other' }]],
    [5, [{ code: 'other' }]],
  ]);
});

test('a row still in progress is not listed, and is listed as other once the dead-letter write of E07-S05 has failed it', async () => {
  const world = await pendingWorld();
  const { db, pending, t1 } = world;
  await storeEvaluations(world, plainOf(t1), [{ prNumber: 5, head: 3, result: 'in_progress', details: {} }]);
  expect(pageOf(await pending('admin1', t1.installationId)).items).toEqual([]);
  const key = {
    installationId: t1.installationId,
    repositoryId: t1.plain.repositoryId,
    prNumber: 5,
    headSha: shaOf(3),
  };
  expect(await failEvaluation(db, key, 'keep')).not.toBeNull();
  expect(pageOf(await pending('admin1', t1.installationId)).items.map((item) => item.reasons)).toEqual([
    [{ code: 'other' }],
  ]);
});

test('every entry of HOSTILE_NAMES stored as a login comes back byte for byte, in a response that is JSON and escapes nothing', async () => {
  const world = await pendingWorld();
  const { db, pending, t1 } = world;
  const firstId = 7000;
  await db
    .insertInto('users')
    .values(HOSTILE_NAMES.map((login, index) => ({ github_id: firstId + index, login, name: null, avatar_url: null })))
    .execute();
  await storeEvaluations(world, plainOf(t1), [
    {
      prNumber: 5,
      details: {
        codes: ['unsigned_contributor'],
        actors: HOSTILE_NAMES.map((_name, index) => ({ githubId: firstId + index })),
      },
    },
  ]);
  const response = await pending('admin1', t1.installationId);
  const logins = pageOf(response).items.flatMap((item) => item.reasons.map((reason) => reason.login));
  expect(logins).toEqual([...HOSTILE_NAMES]);
  for (const name of HOSTILE_NAMES) {
    expect(response.body).toContain(JSON.stringify(name));
  }
});
