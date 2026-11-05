// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { jobCount } from '../../services/jobs-fixture/test-support.ts';
import {
  COMMIT,
  overrideIdOf,
  overrideOf,
  overridesIn,
  overrideWorld,
  recordAs,
  removeOverrideAs,
  SEEDED_COMMIT,
  scopedOf,
  seedOverrides,
  shaOf,
} from './commit-override-fixture/test-support.ts';
import { auditRows, errorCodeOf, tablesOf, withoutRequestId } from './document-fixture/test-support.ts';
import { setEnabled, suspendTenantOne } from './repository-document-fixture/test-support.ts';

// DELETE /api/repositories/:repositoryId/commit-overrides/:overrideId (E15-S06): what a removal deletes, answers and audits, and what it
// refuses, on the real application over PGlite. The jobs are in commit-override-remove-jobs.test.ts, the other tenant's ids in
// commit-override-remove-tenants.test.ts, the service under the lock in commit-override-remove-service.test.ts.

type World = Awaited<ReturnType<typeof overrideWorld>>;

/** Removes the override as `who` and checks that no tenant table changed, no audit row was written and no job was sent. */
async function refused(
  world: World,
  who: Parameters<typeof removeOverrideAs>[1],
  path: [number | string, number | string],
) {
  const before = await tablesOf(world);
  const audit = await auditRows(world, 'commit_override.deleted');
  const jobs = await jobCount(world.db);
  const response = await removeOverrideAs(world, who, path[0], path[1]);
  expect(await tablesOf(world)).toEqual(before);
  expect(await auditRows(world, 'commit_override.deleted')).toEqual(audit);
  expect(await jobCount(world.db)).toBe(jobs);
  return response;
}

test('the org admin removes an override: 204 with no body, no-store, the row is gone and the other overrides stay', async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  await seedOverrides(world, scopedOf(t1), [
    { commitSha: shaOf(1), createdAt: '2026-10-01T10:00:00Z' },
    { commitSha: shaOf(2), createdAt: '2026-10-02T10:00:00Z' },
  ]);
  const id = await overrideIdOf(world, t1.scoped.repositoryId, shaOf(1));
  const kept = await overrideIdOf(world, t1.scoped.repositoryId, shaOf(2));
  const response = await removeOverrideAs(world, 'admin1', t1.scoped.repositoryId, id);
  expect(response.statusCode).toBe(204);
  expect(response.body).toBe('');
  expect(response.headers['cache-control']).toBe('no-store');
  expect(await overridesIn(world, t1.scoped.repositoryId)).toEqual([[kept, shaOf(2)]]);
  expect(await overridesIn(world, t1.plain.repositoryId)).toHaveLength(1);
});

test('the history of a removed override is two audit rows: the record and the removal, with ids and the commit only, naming the person who removed it', async () => {
  const world = await overrideWorld();
  const { t1, people } = world;
  const recorded = await recordAs(world, 'admin1', t1.plain.repositoryId, COMMIT);
  const { id } = overrideOf(recorded);
  const removed = await removeOverrideAs(world, 'admin1', t1.plain.repositoryId, id);
  expect(removed.statusCode).toBe(204);
  const [created] = await auditRows(world, 'commit_override.created');
  const [deleted, ...more] = await auditRows(world, 'commit_override.deleted');
  expect(more).toEqual([]);
  expect(deleted).toMatchObject({
    action: 'commit_override.deleted',
    installation_id: t1.installationId,
    actor_github_id: people.admin1.githubId,
    subject_type: 'commit_override',
    subject_id: id,
    metadata: { repository_id: t1.plain.repositoryId, commit_sha: COMMIT },
  });
  expect(created).toMatchObject({ subject_type: 'commit_override', subject_id: id });
  expect(Object.keys(deleted?.metadata ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual([
    'commit_sha',
    'repository_id',
  ]);
});

test('the admin of a repository removes an override of the repository whose document is its own, and the row names nobody else in the audit', async () => {
  const world = await overrideWorld();
  const { t1, people } = world;
  const recorded = await recordAs(world, 'repoAdmin1', t1.scoped.repositoryId, COMMIT);
  const response = await removeOverrideAs(world, 'repoAdmin1', t1.scoped.repositoryId, overrideOf(recorded).id);
  expect(response.statusCode).toBe(204);
  expect(await overridesIn(world, t1.scoped.repositoryId)).toEqual([]);
  expect((await auditRows(world, 'commit_override.deleted')).map((row) => row.actor_github_id)).toEqual([
    people.repoAdmin1.githubId,
  ]);
});

test('the admin of a repository whose document is the organisation is 403 forbidden, also for an id that does not exist, and the override stays', async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  const id = await overrideIdOf(world, t1.plain.repositoryId, SEEDED_COMMIT);
  const real = await refused(world, 'repoAdmin1', [t1.plain.repositoryId, id]);
  const unknown = await refused(world, 'repoAdmin1', [t1.plain.repositoryId, 987_654]);
  expect([real, unknown].map((response) => [response.statusCode, errorCodeOf(response)])).toEqual([
    [403, 'forbidden'],
    [403, 'forbidden'],
  ]);
  expect(await overridesIn(world, t1.plain.repositoryId)).toEqual([[id, SEEDED_COMMIT]]);
});

test('a person with no role in the installation, and the admin of the other tenant, get the 404 of an unknown repository, byte for byte; without a session the call is 401, without the origin and the token 403', async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  const id = await overrideIdOf(world, t1.plain.repositoryId, SEEDED_COMMIT);
  const unknown = await refused(world, 'admin1', [987_654, id]);
  const answers = [
    await refused(world, 'member1', [t1.plain.repositoryId, id]),
    await refused(world, 'outsider', [t1.plain.repositoryId, id]),
    await refused(world, 'admin2', [t1.plain.repositoryId, id]),
  ];
  expect([unknown, ...answers].map((answer) => answer.statusCode)).toEqual([404, 404, 404, 404]);
  expect(answers.map(withoutRequestId)).toEqual(answers.map(() => withoutRequestId(unknown)));
  const none = await removeOverrideAs(world, null, t1.plain.repositoryId, id);
  const noToken = await world.app.inject({
    method: 'DELETE',
    url: `/api/repositories/${t1.plain.repositoryId}/commit-overrides/${id}`,
  });
  expect([none.statusCode, noToken.statusCode]).toEqual([401, 403]);
  expect(await overridesIn(world, t1.plain.repositoryId)).toEqual([[id, SEEDED_COMMIT]]);
});

test('an override that is unknown, that was removed already, or that belongs to another repository of the tenant is 404 not_found, the same body for all, and nothing changes', async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  await seedOverrides(world, scopedOf(t1), [{ commitSha: shaOf(1), createdAt: '2026-10-01T10:00:00Z' }]);
  const scopedId = await overrideIdOf(world, t1.scoped.repositoryId, shaOf(1));
  const plainId = await overrideIdOf(world, t1.plain.repositoryId, SEEDED_COMMIT);
  expect((await removeOverrideAs(world, 'admin1', t1.scoped.repositoryId, scopedId)).statusCode).toBe(204);
  const answers = [
    await refused(world, 'admin1', [t1.scoped.repositoryId, 987_654]),
    await refused(world, 'admin1', [t1.scoped.repositoryId, scopedId]),
    await refused(world, 'admin1', [t1.scoped.repositoryId, plainId]),
    await refused(world, 'admin1', [t1.plain.repositoryId, scopedId]),
  ];
  expect(answers.map((answer) => [answer.statusCode, errorCodeOf(answer)])).toEqual(
    answers.map(() => [404, 'not_found']),
  );
  expect(new Set(answers.map(withoutRequestId)).size).toBe(1);
  expect(await overridesIn(world, t1.plain.repositoryId)).toEqual([[plainId, SEEDED_COMMIT]]);
});

test.each([
  ['a word', 'latest'],
  ['zero', '0'],
  ['a leading zero', '07'],
  ['a sign', '-1'],
  ['a decimal', '1.5'],
  ['an exponent', '1e3'],
])(
  'an override id that is %s is 400 bad_request for a person with the role, and nothing changes',
  async (_name, id) => {
    const world = await overrideWorld();
    const response = await refused(world, 'admin1', [world.t1.plain.repositoryId, id]);
    expect([response.statusCode, errorCodeOf(response)]).toEqual([400, 'bad_request']);
  },
);

test('a stranger is 404 whatever the override id looks like: the guard answers before the id is read', async () => {
  const world = await overrideWorld();
  const response = await removeOverrideAs(world, 'outsider', world.t1.plain.repositoryId, 'latest');
  expect(response.statusCode).toBe(404);
});

test('a suspended installation is 409 installation_suspended, also for the org admin the ledger remembers, and the override stays', async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  const id = await overrideIdOf(world, t1.plain.repositoryId, SEEDED_COMMIT);
  await suspendTenantOne(world);
  const response = await refused(world, 'admin1', [t1.plain.repositoryId, id]);
  expect([response.statusCode, errorCodeOf(response)]).toEqual([409, 'installation_suspended']);
});

test('a repository that is switched off can be cleaned of its overrides', async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  const id = await overrideIdOf(world, t1.plain.repositoryId, SEEDED_COMMIT);
  await setEnabled(world, t1.plain.repositoryId, false);
  expect((await removeOverrideAs(world, 'admin1', t1.plain.repositoryId, id)).statusCode).toBe(204);
  expect(await overridesIn(world, t1.plain.repositoryId)).toEqual([]);
  expect(await auditRows(world, 'commit_override.deleted')).toHaveLength(1);
});

test('after a removal the same commit can be overridden again: a new row with a new id and a new audit row, and the unique key is not blocked by the history', async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  const first = overrideOf(await recordAs(world, 'admin1', t1.plain.repositoryId, COMMIT));
  const blocked = await recordAs(world, 'admin1', t1.plain.repositoryId, COMMIT);
  expect(blocked.statusCode).toBe(409);
  expect((await removeOverrideAs(world, 'admin1', t1.plain.repositoryId, first.id)).statusCode).toBe(204);
  const again = await recordAs(world, 'admin1', t1.plain.repositoryId, COMMIT);
  expect(again.statusCode).toBe(201);
  const second = overrideOf(again);
  expect(second.id).toBeGreaterThan(first.id);
  expect(await overrideIdOf(world, t1.plain.repositoryId, COMMIT)).toBe(second.id);
  expect((await auditRows(world, 'commit_override.created')).map((row) => row.subject_id)).toEqual([
    first.id,
    second.id,
  ]);
  expect((await auditRows(world, 'commit_override.deleted')).map((row) => row.subject_id)).toEqual([first.id]);
  expect((await removeOverrideAs(world, 'admin1', t1.plain.repositoryId, first.id)).statusCode).toBe(404);
});
