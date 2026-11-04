// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { realPostgresOnly } from '../db/test-support.ts';
import { errorCodeOf, tablesOf, withoutRequestId } from './document-fixture/test-support.ts';
import { signerPath } from './public-verification-fixture/test-support.ts';
import { pointAt, setEnabled } from './repository-document-fixture/test-support.ts';
import {
  optInAnswerOf,
  optInAs,
  optInAt,
  optInAuditRows,
  optInState,
  optInWorld,
} from './repository-public-verification-fixture/test-support.ts';

// The other tenant's ids, the race and the effect on the public call of PUT .../repositories/:repositoryId/public-verification
// (E22-S02). The roles, the audit and the refusals are in repository-public-verification-routes.test.ts.

test("the other tenant's repository id is 404 for either org admin, the answer for an id that exists nowhere, and no row of any tenant changes", async () => {
  const world = await optInWorld();
  const { t1, t2 } = world;
  const unknown = await optInAs(world, 'admin1', 987_654, { enabled: true });
  const before = await tablesOf(world);
  const answers = [
    await optInAs(world, 'admin1', t2.plain.repositoryId, { enabled: true }),
    await optInAs(world, 'admin1', t2.scoped.repositoryId, { enabled: true }),
    await optInAt(
      world,
      'admin2',
      { installationId: t2.installationId, repositoryId: t1.plain.repositoryId },
      { enabled: true },
    ),
    await optInAt(
      world,
      'admin2',
      { installationId: t2.installationId, repositoryId: t1.scoped.repositoryId },
      { enabled: true },
    ),
  ];
  expect(answers.map((answer) => answer.statusCode)).toEqual([404, 404, 404, 404]);
  expect(answers.map(withoutRequestId)).toEqual(answers.map(() => withoutRequestId(unknown)));
  expect(await tablesOf(world)).toEqual(before);
});

test("an installation id of one tenant with the repository of the other is 404 for the admin of either, and the other tenant's repository is unchanged", async () => {
  const world = await optInWorld();
  const { t1, t2 } = world;
  const crossed = [
    await optInAt(
      world,
      'admin1',
      { installationId: t1.installationId, repositoryId: t2.plain.repositoryId },
      { enabled: true },
    ),
    await optInAt(
      world,
      'admin1',
      { installationId: t2.installationId, repositoryId: t1.plain.repositoryId },
      { enabled: true },
    ),
    await optInAt(
      world,
      'admin2',
      { installationId: t2.installationId, repositoryId: t1.plain.repositoryId },
      { enabled: true },
    ),
    await optInAt(
      world,
      'admin2',
      { installationId: t1.installationId, repositoryId: t2.plain.repositoryId },
      { enabled: true },
    ),
  ];
  expect(crossed.map((answer) => [answer.statusCode, errorCodeOf(answer)])).toEqual(Array(4).fill([404, 'not_found']));
  expect((await optInState(world, t1.plain.repositoryId)).public_verification).toBe(false);
  expect((await optInState(world, t2.plain.repositoryId)).public_verification).toBe(false);
});

test('a change in one tenant writes its audit row under that tenant and leaves the other tenant, its repositories and its audit log, as they were', async () => {
  const world = await optInWorld();
  const { t1, t2 } = world;
  const otherRepositories = await world.db
    .selectFrom('repositories')
    .selectAll()
    .where('installation_id', '=', t2.installationId)
    .orderBy('id')
    .execute();
  const otherAudit = await world.db
    .selectFrom('audit_log')
    .selectAll()
    .where('installation_id', '=', t2.installationId)
    .orderBy('id')
    .execute();
  const response = await optInAs(world, 'admin1', t1.plain.repositoryId, { enabled: true });
  expect(response.statusCode).toBe(200);
  expect((await optInAuditRows(world, t1.plain.githubRepoId)).map((row) => row.installation_id)).toEqual([
    t1.installationId,
  ]);
  expect(
    await world.db
      .selectFrom('repositories')
      .selectAll()
      .where('installation_id', '=', t2.installationId)
      .orderBy('id')
      .execute(),
  ).toEqual(otherRepositories);
  expect(
    await world.db
      .selectFrom('audit_log')
      .selectAll()
      .where('installation_id', '=', t2.installationId)
      .orderBy('id')
      .execute(),
  ).toEqual(otherAudit);
});

test('the opt-in is what opens the public call: 404 before, an answer after, and 404 again once the maintainers turn it off', async () => {
  const world = await optInWorld();
  const { t1 } = world;
  await pointAt(world, t1.plain.repositoryId, t1.documentId);
  await setEnabled(world, t1.plain.repositoryId, true);
  world.fakeGitHub.scriptUserAccount('octocat', { id: t1.signer.githubId, login: 'octocat', type: 'User' });
  const url = signerPath(t1.plain.githubRepoId, 'octocat');
  expect((await world.app.inject({ url })).statusCode).toBe(404);
  await optInAs(world, 'admin1', t1.plain.repositoryId, { enabled: true });
  const open = await world.app.inject({ url });
  expect([open.statusCode, open.body]).toEqual([200, '{"signed":true}']);
  await optInAs(world, 'admin1', t1.plain.repositoryId, { enabled: false });
  expect((await world.app.inject({ url })).statusCode).toBe(404);
});

test('two calls one after the other give a changed true and a changed false, and one audit row, on whatever engine runs the suite', async () => {
  const world = await optInWorld();
  const first = await optInAs(world, 'admin1', world.t1.plain.repositoryId, { enabled: true });
  const second = await optInAs(world, 'admin1', world.t1.plain.repositoryId, { enabled: true });
  expect([optInAnswerOf(first).changed, optInAnswerOf(second).changed]).toEqual([true, false]);
  expect(await optInAuditRows(world, world.t1.plain.githubRepoId)).toHaveLength(1);
});

realPostgresOnly(
  'five simultaneous calls give one changed true and four changed false, and one audit row, every round',
  async () => {
    const world = await optInWorld();
    const { t1 } = world;
    const answers = await Promise.all(
      Array.from({ length: 5 }, () => optInAs(world, 'admin1', t1.plain.repositoryId, { enabled: true })),
    );
    expect(answers.map((answer) => answer.statusCode)).toEqual([200, 200, 200, 200, 200]);
    const changes = answers.map((answer) => optInAnswerOf(answer).changed).toSorted((a, b) => Number(a) - Number(b));
    expect(changes).toEqual([false, false, false, false, true]);
    expect((await optInState(world, t1.plain.repositoryId)).public_verification).toBe(true);
    expect(await optInAuditRows(world, t1.plain.githubRepoId)).toHaveLength(1);
  },
);
