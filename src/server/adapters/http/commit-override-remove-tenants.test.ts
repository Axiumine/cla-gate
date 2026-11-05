// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { jobCount } from '../../services/jobs-fixture/test-support.ts';
import {
  jobsOf,
  overriddenPullRequest,
  overrideIdOf,
  overridesIn,
  overrideWorld,
  plainOf,
  removeOverrideAs,
  SEEDED_COMMIT,
  waivedBy,
} from './commit-override-fixture/test-support.ts';
import { auditRows, tablesOf, withoutRequestId } from './document-fixture/test-support.ts';

// The cross-tenant checks of DELETE /api/repositories/:repositoryId/commit-overrides/:overrideId (E15-S06): the other tenant's override id
// under this tenant's repository, the other tenant's repository, and the same commit overridden in both tenants. The matrix of E11-S06
// holds the role cases.

test("tenant 2's override id under tenant 1's repository is 404, the answer for an id that exists nowhere, and the row, every tenant table and the queue stay as they were", async () => {
  const world = await overrideWorld();
  const { t1, t2 } = world;
  const foreign = await overrideIdOf(world, t2.plain.repositoryId, SEEDED_COMMIT);
  const unknown = await removeOverrideAs(world, 'admin1', t1.plain.repositoryId, 987_654);
  const before = await tablesOf(world);
  const answers = [
    await removeOverrideAs(world, 'admin1', t1.plain.repositoryId, foreign),
    await removeOverrideAs(world, 'admin1', t1.scoped.repositoryId, foreign),
  ];
  expect(answers.map((answer) => answer.statusCode)).toEqual([404, 404]);
  expect(answers.map(withoutRequestId)).toEqual(answers.map(() => withoutRequestId(unknown)));
  expect(await tablesOf(world)).toEqual(before);
  expect(await overridesIn(world, t2.plain.repositoryId)).toEqual([[foreign, SEEDED_COMMIT]]);
  expect(await auditRows(world, 'commit_override.deleted')).toEqual([]);
  expect(await jobCount(world.db)).toBe(0);
});

test("tenant 2's repository is 404 for either org admin and for the admin of a repository, whichever override id is named, and no row changes", async () => {
  const world = await overrideWorld();
  const { t1, t2 } = world;
  const own = await overrideIdOf(world, t1.plain.repositoryId, SEEDED_COMMIT);
  const foreign = await overrideIdOf(world, t2.plain.repositoryId, SEEDED_COMMIT);
  const unknown = await removeOverrideAs(world, 'admin1', 987_654, own);
  const before = await tablesOf(world);
  const answers = [
    await removeOverrideAs(world, 'admin1', t2.plain.repositoryId, foreign),
    await removeOverrideAs(world, 'admin1', t2.plain.repositoryId, own),
    await removeOverrideAs(world, 'admin2', t1.plain.repositoryId, own),
    await removeOverrideAs(world, 'admin2', t1.plain.repositoryId, foreign),
    await removeOverrideAs(world, 'repoAdmin1', t2.scoped.repositoryId, foreign),
  ];
  expect(answers.map((answer) => answer.statusCode)).toEqual([404, 404, 404, 404, 404]);
  expect(answers.map(withoutRequestId)).toEqual(answers.map(() => withoutRequestId(unknown)));
  expect(await tablesOf(world)).toEqual(before);
});

test("removing tenant 1's override of a commit leaves tenant 2's override of the same commit in place, writes nothing under tenant 2, and sends no job for tenant 2's pull requests", async () => {
  const world = await overrideWorld();
  const { t1, t2 } = world;
  const own = await overrideIdOf(world, t1.plain.repositoryId, SEEDED_COMMIT);
  const foreign = await overrideIdOf(world, t2.plain.repositoryId, SEEDED_COMMIT);
  await overriddenPullRequest(world, plainOf(t2), {
    prNumber: 101,
    unlinked: waivedBy(foreign),
  });
  const otherAudit = await world.db
    .selectFrom('audit_log')
    .selectAll()
    .where('installation_id', '=', t2.installationId)
    .orderBy('id')
    .execute();
  const response = await removeOverrideAs(world, 'admin1', t1.plain.repositoryId, own);
  expect(response.statusCode).toBe(204);
  expect(await overridesIn(world, t1.plain.repositoryId)).toEqual([]);
  expect(await overridesIn(world, t2.plain.repositoryId)).toEqual([[foreign, SEEDED_COMMIT]]);
  expect(
    await world.db
      .selectFrom('audit_log')
      .selectAll()
      .where('installation_id', '=', t2.installationId)
      .orderBy('id')
      .execute(),
  ).toEqual(otherAudit);
  expect(await jobsOf(world, 'evaluate-pr')).toEqual([]);
  expect((await auditRows(world, 'commit_override.deleted')).map((row) => row.installation_id)).toEqual([
    t1.installationId,
  ]);
});

test('the same commit can be removed in both tenants independently, each removal under its own installation', async () => {
  const world = await overrideWorld();
  const { t1, t2 } = world;
  const first = await removeOverrideAs(
    world,
    'admin1',
    t1.plain.repositoryId,
    await overrideIdOf(world, t1.plain.repositoryId, SEEDED_COMMIT),
  );
  const second = await removeOverrideAs(
    world,
    'admin2',
    t2.plain.repositoryId,
    await overrideIdOf(world, t2.plain.repositoryId, SEEDED_COMMIT),
  );
  expect([first.statusCode, second.statusCode]).toEqual([204, 204]);
  expect((await auditRows(world, 'commit_override.deleted')).map((row) => row.installation_id)).toEqual([
    t1.installationId,
    t2.installationId,
  ]);
});
