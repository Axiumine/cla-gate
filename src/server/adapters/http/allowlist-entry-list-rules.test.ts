// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  allowlistWorld,
  installationPageOf,
  listInstallationAs,
  listRepositoryAs,
  repositoryPageOf,
} from './allowlist-list-fixture/test-support.ts';
import { errorCodeOf, tablesOf } from './document-fixture/test-support.ts';
import { pointAt } from './repository-document-fixture/test-support.ts';

// Who may read the lists of the allowlist (E14-S07): an org admin always; the admin of a repository only for the list of that repository
// and only while the document it enforces is its own (the repository-action rule of E14-S01); everybody else is told nothing.

test('the list of an installation is for an org admin: the admin of a repository is 403, a member and a stranger 404, nobody signed in 401', async () => {
  const world = await allowlistWorld();
  const { installationId } = world.t1;
  const before = await tablesOf(world);
  const admin = await listInstallationAs(world, 'admin1', installationId);
  const repoAdmin = await listInstallationAs(world, 'repoAdmin1', installationId);
  const others = [
    await listInstallationAs(world, 'member1', installationId),
    await listInstallationAs(world, 'outsider', installationId),
    await listInstallationAs(world, 'admin2', installationId),
    await listInstallationAs(world, null, installationId),
  ];
  expect([admin.statusCode, repoAdmin.statusCode, ...others.map((answer) => answer.statusCode)]).toEqual([
    200, 403, 404, 404, 404, 401,
  ]);
  expect(errorCodeOf(repoAdmin)).toBe('forbidden');
  expect(installationPageOf(admin).entries).toHaveLength(1);
  expect(await tablesOf(world)).toEqual(before);
});

test('the list of a repository whose document is its own is for the admin of that repository and for an org admin', async () => {
  const world = await allowlistWorld();
  const { t1 } = world;
  await pointAt(world, t1.scoped.repositoryId, t1.scoped.documentId);
  const answers = [
    await listRepositoryAs(world, 'repoAdmin1', t1.scoped.repositoryId),
    await listRepositoryAs(world, 'admin1', t1.scoped.repositoryId),
  ];
  expect(answers.map((answer) => answer.statusCode)).toEqual([200, 200]);
  expect(answers.map((answer) => repositoryPageOf(answer).inherited.map((entry) => entry.githubId))).toEqual([
    [100],
    [100],
  ]);
});

test.each([
  ['the document of the organisation', (t1: { documentId: number }) => t1.documentId],
  ['no document', () => null],
])(
  'the list of a repository that enforces %s is for an org admin only: the admin of the repository is 403',
  async (_label, attached) => {
    const world = await allowlistWorld();
    const { t1 } = world;
    await pointAt(world, t1.scoped.repositoryId, attached(t1));
    const refused = await listRepositoryAs(world, 'repoAdmin1', t1.scoped.repositoryId);
    const allowed = await listRepositoryAs(world, 'admin1', t1.scoped.repositoryId);
    expect([refused.statusCode, errorCodeOf(refused), allowed.statusCode]).toEqual([403, 'forbidden', 200]);
    expect(refused.body).not.toContain('"githubId"');
  },
);

test('the admin of one repository cannot list another repository of the installation, a member and a stranger are 404, nobody signed in 401', async () => {
  const world = await allowlistWorld();
  const { t1 } = world;
  await pointAt(world, t1.scoped.repositoryId, t1.scoped.documentId);
  const answers = [
    await listRepositoryAs(world, 'repoAdmin1', t1.plain.repositoryId),
    await listRepositoryAs(world, 'member1', t1.scoped.repositoryId),
    await listRepositoryAs(world, 'outsider', t1.scoped.repositoryId),
    await listRepositoryAs(world, 'admin2', t1.scoped.repositoryId),
    await listRepositoryAs(world, null, t1.scoped.repositoryId),
  ];
  expect(answers.map((answer) => answer.statusCode)).toEqual([403, 404, 404, 404, 401]);
});

test('a repository GitHub no longer lists is 404 for everybody, an org admin included: its entries are reached from the installation only', async () => {
  const world = await allowlistWorld();
  const { t1 } = world;
  await world.db
    .updateTable('repositories')
    .set({ removed_at: new Date('2026-10-01T00:00:00Z') })
    .where('id', '=', t1.scoped.repositoryId)
    .execute();
  const answer = await listRepositoryAs(world, 'admin1', t1.scoped.repositoryId);
  expect([answer.statusCode, errorCodeOf(answer)]).toEqual([404, 'not_found']);
});

test('a repository that is not there is the same 404 as one of another tenant, and the list asks GitHub nothing', async () => {
  const world = await allowlistWorld();
  const unknown = await listRepositoryAs(world, 'admin1', 987_654);
  const foreign = await listRepositoryAs(world, 'admin1', world.t2.plain.repositoryId);
  expect([unknown.statusCode, foreign.statusCode]).toEqual([404, 404]);
  expect(foreign.body.replace(/"requestId":"[^"]*"/, '')).toBe(unknown.body.replace(/"requestId":"[^"]*"/, ''));
  expect(world.fakeGitHub.calls).toEqual([]);
});

test.each(['0', '01', '-1', 'abc', '1.5', '1e3'])(
  'the id %s in the path of a list is 400 bad_request, as for every route that names a repository or an installation',
  async (id) => {
    const world = await allowlistWorld();
    const installation = await listInstallationAs(world, 'admin1', id);
    const repository = await listRepositoryAs(world, 'admin1', id);
    expect([installation.statusCode, repository.statusCode]).toEqual([400, 400]);
  },
);
