// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  COMMIT,
  listOverridesAs,
  overrideWorld,
  pageOf,
  REASON,
  scopedOf,
  seedOverrides,
  shaOf,
} from './commit-override-fixture/test-support.ts';
import { auditRows, errorCodeOf, tablesOf, withoutRequestId } from './document-fixture/test-support.ts';
import { pointAt, setEnabled } from './repository-document-fixture/test-support.ts';

// GET /api/repositories/:repositoryId/commit-overrides (E15-S06): what the list answers, who may read it and what it leaves alone, on the
// real application over PGlite. The pages are in commit-override-list-pages.test.ts, the other tenant's rows in
// commit-override-list-tenants.test.ts, the strings a maintainer typed in commit-override-hostile.test.ts.

test('the org admin reads the overrides newest first, each with the commit, the reason, the author by numeric id and the instant in UTC, and the answer is told not to be cached', async () => {
  const world = await overrideWorld();
  const { t1, people } = world;
  await seedOverrides(world, scopedOf(t1), [
    { commitSha: shaOf(1), createdAt: '2026-10-01T10:00:00.250Z', reason: 'first' },
    { commitSha: shaOf(2), createdAt: '2026-10-03T10:00:00Z', reason: 'third', createdBy: people.repoAdmin1.userId },
    { commitSha: shaOf(3), createdAt: '2026-10-02T10:00:00Z', reason: 'second' },
  ]);
  const response = await listOverridesAs(world, 'admin1', t1.scoped.repositoryId);
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  const { items, nextCursor } = pageOf(response);
  expect(nextCursor).toBeNull();
  const stored = await world.db.selectFrom('commit_overrides').select(['id', 'commit_sha']).execute();
  const idOf = (sha: string) => stored.find((row) => row.commit_sha === sha)?.id;
  expect(items).toEqual([
    {
      id: idOf(shaOf(2)),
      commitSha: shaOf(2),
      reason: 'third',
      createdBy: { githubId: people.repoAdmin1.githubId, login: people.repoAdmin1.login },
      createdAt: '2026-10-03T10:00:00.000Z',
    },
    {
      id: idOf(shaOf(3)),
      commitSha: shaOf(3),
      reason: 'second',
      createdBy: { githubId: people.admin1.githubId, login: people.admin1.login },
      createdAt: '2026-10-02T10:00:00.000Z',
    },
    {
      id: idOf(shaOf(1)),
      commitSha: shaOf(1),
      reason: 'first',
      createdBy: { githubId: people.admin1.githubId, login: people.admin1.login },
      createdAt: '2026-10-01T10:00:00.250Z',
    },
  ]);
});

test('an item holds exactly the five fields of the story, so no repository, installation or user row id leaks', async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  await seedOverrides(world, scopedOf(t1), [{ commitSha: shaOf(1), createdAt: '2026-10-01T10:00:00Z' }]);
  const page = (await listOverridesAs(world, 'admin1', t1.scoped.repositoryId)).json<Record<string, unknown>>();
  expect(Object.keys(page).toSorted((a, b) => a.localeCompare(b))).toEqual(['items', 'nextCursor']);
  const [item] = pageOf(await listOverridesAs(world, 'admin1', t1.scoped.repositoryId)).items;
  expect(Object.keys(item ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual([
    'commitSha',
    'createdAt',
    'createdBy',
    'id',
    'reason',
  ]);
  expect(Object.keys(item?.createdBy ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual(['githubId', 'login']);
});

test('a repository with no override answers an empty page, and the overrides of its sibling repository are not in it', async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  await seedOverrides(world, scopedOf(t1), [{ commitSha: shaOf(1), createdAt: '2026-10-01T10:00:00Z' }]);
  const plain = await listOverridesAs(world, 'admin1', t1.plain.repositoryId);
  expect(pageOf(plain).items.map((item) => item.commitSha)).toEqual(['a'.repeat(40)]);
  await world.db.deleteFrom('commit_overrides').where('repository_id', '=', t1.plain.repositoryId).execute();
  const empty = await listOverridesAs(world, 'admin1', t1.plain.repositoryId);
  expect([empty.statusCode, pageOf(empty)]).toEqual([200, { items: [], nextCursor: null }]);
});

test('the login is the display snapshot the users row holds now, and the numeric GitHub id is the identity', async () => {
  const world = await overrideWorld();
  const { t1, people } = world;
  await seedOverrides(world, scopedOf(t1), [
    { commitSha: shaOf(1), createdAt: '2026-10-01T10:00:00Z', createdBy: people.member1.userId },
  ]);
  await world.db
    .updateTable('users')
    .set({ login: 'renamed-maintainer' })
    .where('id', '=', people.member1.userId)
    .execute();
  const [item] = pageOf(await listOverridesAs(world, 'admin1', t1.scoped.repositoryId)).items;
  expect(item?.createdBy).toEqual({ githubId: people.member1.githubId, login: 'renamed-maintainer' });
});

test('the role is the one that records an override: the admin of a repository reads the list of the repository whose document is its own, and is 403 for the one that enforces the document of the organisation', async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  const own = await listOverridesAs(world, 'repoAdmin1', t1.scoped.repositoryId);
  const plain = await listOverridesAs(world, 'repoAdmin1', t1.plain.repositoryId);
  expect([own.statusCode, plain.statusCode, errorCodeOf(plain)]).toEqual([200, 403, 'forbidden']);
  await pointAt(world, t1.scoped.repositoryId, t1.documentId);
  const moved = await listOverridesAs(world, 'repoAdmin1', t1.scoped.repositoryId);
  expect([moved.statusCode, errorCodeOf(moved)]).toEqual([403, 'forbidden']);
  expect((await listOverridesAs(world, 'admin1', t1.scoped.repositoryId)).statusCode).toBe(200);
});

test('a person without a role in the installation, and the admin of the other tenant, get the 404 of an unknown repository, byte for byte; without a session the call is 401', async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  const unknown = await listOverridesAs(world, 'admin1', 987_654);
  const answers = [
    await listOverridesAs(world, 'member1', t1.plain.repositoryId),
    await listOverridesAs(world, 'outsider', t1.plain.repositoryId),
    await listOverridesAs(world, 'admin2', t1.plain.repositoryId),
  ];
  expect([unknown.statusCode, ...answers.map((answer) => answer.statusCode)]).toEqual([404, 404, 404, 404]);
  expect(answers.map(withoutRequestId)).toEqual(answers.map(() => withoutRequestId(unknown)));
  expect((await listOverridesAs(world, null, t1.plain.repositoryId)).statusCode).toBe(401);
});

test('a repository that is switched off is listed too: the overrides stay visible', async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  await setEnabled(world, t1.plain.repositoryId, false);
  const response = await listOverridesAs(world, 'admin1', t1.plain.repositoryId);
  expect(response.statusCode).toBe(200);
  expect(pageOf(response).items.map((item) => item.commitSha)).toEqual(['a'.repeat(40)]);
});

test('the list writes nothing: no tenant table changes, no audit row is appended, and the commit is not looked up on GitHub', async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  await seedOverrides(world, scopedOf(t1), [{ commitSha: COMMIT, createdAt: '2026-10-01T10:00:00Z', reason: REASON }]);
  const before = await tablesOf(world);
  const audit = await world.db.selectFrom('audit_log').select('id').execute();
  expect((await listOverridesAs(world, 'admin1', t1.scoped.repositoryId)).statusCode).toBe(200);
  expect((await listOverridesAs(world, 'repoAdmin1', t1.scoped.repositoryId)).statusCode).toBe(200);
  expect(await tablesOf(world)).toEqual(before);
  expect(await world.db.selectFrom('audit_log').select('id').execute()).toEqual(audit);
  expect(await auditRows(world, 'commit_override.created')).toEqual([]);
  expect(world.fakeGitHub.calls.filter((call) => call.method === 'getCommit')).toEqual([]);
});
