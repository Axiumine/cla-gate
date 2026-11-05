// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { readOverrides } from '../../services/evaluate-pr/policy-facts.ts';
import { jobCount } from '../../services/jobs-fixture/test-support.ts';
import {
  COMMIT,
  evaluatedPullRequests,
  lookups,
  overrideOf,
  overrideWorld,
  plainOf,
  recordAs,
  storedOverrides,
} from './commit-override-fixture/test-support.ts';
import { auditRows, tablesOf, withoutRequestId } from './document-fixture/test-support.ts';

// The cross-tenant checks of `POST /api/repositories/:repositoryId/commit-overrides` (E15-S05): the other tenant's repository, the same
// commit overridden in both tenants, and what an override of one tenant does to the other. The matrix of E11-S06 holds the role cases.

test("the other tenant's repository id is 404 for either org admin and for the admin of a repository, the answer for an id that exists nowhere, and no row of any tenant changes", async () => {
  const world = await overrideWorld();
  const { t1, t2 } = world;
  const unknown = await recordAs(world, 'admin1', 987_654, COMMIT);
  const before = await tablesOf(world);
  const answers = [
    await recordAs(world, 'admin1', t2.plain.repositoryId, COMMIT),
    await recordAs(world, 'admin1', t2.scoped.repositoryId, COMMIT),
    await recordAs(world, 'admin2', t1.plain.repositoryId, COMMIT),
    await recordAs(world, 'admin2', t1.scoped.repositoryId, COMMIT),
    await recordAs(world, 'repoAdmin1', t2.scoped.repositoryId, COMMIT),
  ];
  expect(answers.map((answer) => answer.statusCode)).toEqual([404, 404, 404, 404, 404]);
  expect(answers.map(withoutRequestId)).toEqual(answers.map(() => withoutRequestId(unknown)));
  expect(await tablesOf(world)).toEqual(before);
  expect(await jobCount(world.db)).toBe(0);
  expect(lookups(world)).toEqual([]);
});

test('the same commit carries an override in both tenants independently: each is recorded once, under its own installation, and neither is 409 for the other', async () => {
  const world = await overrideWorld();
  const { t1, t2 } = world;
  const first = await recordAs(world, 'admin1', t1.plain.repositoryId, COMMIT);
  const second = await recordAs(world, 'admin2', t2.plain.repositoryId, COMMIT);
  const again = await recordAs(world, 'admin1', t1.plain.repositoryId, COMMIT);
  expect([first.statusCode, second.statusCode, again.statusCode]).toEqual([201, 201, 409]);
  expect((await storedOverrides(world)).map((row) => [row.installation_id, row.repository_id, row.commit_sha])).toEqual(
    [
      [t1.installationId, t1.plain.repositoryId, COMMIT],
      [t2.installationId, t2.plain.repositoryId, COMMIT],
    ],
  );
  expect(overrideOf(second).createdBy.githubId).toBe(world.people.admin2.githubId);
  expect((await auditRows(world, 'commit_override.created')).map((row) => row.installation_id)).toEqual([
    t1.installationId,
    t2.installationId,
  ]);
});

test("the commit is looked up under each tenant's own installation", async () => {
  const world = await overrideWorld();
  const { t1, t2 } = world;
  await recordAs(world, 'admin1', t1.plain.repositoryId, COMMIT);
  await recordAs(world, 'admin2', t2.plain.repositoryId, COMMIT);
  expect(lookups(world).map((call) => call.installationId)).toEqual([t1.githubInstallationId, t2.githubInstallationId]);
});

test("an override of tenant 1 is not in tenant 2's policy for the same commit, and writes nothing under tenant 2", async () => {
  const world = await overrideWorld();
  const { t1, t2 } = world;
  await evaluatedPullRequests(world, plainOf(t2), { numbers: [101], result: 'failure' });
  const otherOverrides = await world.db
    .selectFrom('commit_overrides')
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
  const response = await recordAs(world, 'admin1', t1.plain.repositoryId, COMMIT);
  expect(response.statusCode).toBe(201);
  const policy = (tenant: typeof t1) => ({
    db: world.db,
    installationId: tenant.installationId,
    repositoryId: tenant.plain.repositoryId,
  });
  expect([...(await readOverrides(policy(t1), [COMMIT]))]).toEqual([[COMMIT, overrideOf(response).id]]);
  expect([...(await readOverrides(policy(t2), [COMMIT]))]).toEqual([]);
  expect(
    await world.db
      .selectFrom('commit_overrides')
      .selectAll()
      .where('installation_id', '=', t2.installationId)
      .orderBy('id')
      .execute(),
  ).toEqual(otherOverrides);
  expect(
    await world.db
      .selectFrom('audit_log')
      .selectAll()
      .where('installation_id', '=', t2.installationId)
      .orderBy('id')
      .execute(),
  ).toEqual(otherAudit);
  expect(await jobCount(world.db)).toBe(0);
});
