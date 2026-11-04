// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { jobCount } from '../../services/jobs-fixture/test-support.ts';
import { auditRows, errorCodeOf, tablesOf, withoutRequestId } from './document-fixture/test-support.ts';
import { disableAs, disabledAnswerOf, disableWorld } from './repository-disable-fixture/test-support.ts';
import { pointAt, repositoryState, setEnabled, suspendTenantOne } from './repository-document-fixture/test-support.ts';

// The roles and states that refuse turning enforcement off (E14-S04), which are those of turning it on (E14-S03): a role that is too
// low for the document the repository enforces, a person with no role, and a tenant that is away. Each refusal leaves every tenant
// table as it was and sends no job.

/** Asks as `who` and checks that the call changed no tenant table and sent no job. */
async function refusedAs(
  world: Awaited<ReturnType<typeof disableWorld>>,
  who: Parameters<typeof disableAs>[1],
  repositoryId: number,
) {
  const before = await tablesOf(world);
  const response = await disableAs(world, who, repositoryId);
  expect(await tablesOf(world)).toEqual(before);
  expect(await jobCount(world.db)).toBe(0);
  return response;
}

test("the admin of a repository whose document is the organisation's is 403 forbidden, and an org admin is let in by the same call", async () => {
  const world = await disableWorld();
  const { t1 } = world;
  await pointAt(world, t1.scoped.repositoryId, t1.documentId);
  const refused = await refusedAs(world, 'repoAdmin1', t1.scoped.repositoryId);
  expect([refused.statusCode, errorCodeOf(refused)]).toEqual([403, 'forbidden']);
  expect((await repositoryState(world, t1.scoped.repositoryId)).enabled).toBe(true);
  const org = await disableAs(world, 'admin1', t1.scoped.repositoryId);
  expect([org.statusCode, disabledAnswerOf(org).changed]).toEqual([200, true]);
});

test('the admin of a repository with no document attached is 403: the policy then is the organisation', async () => {
  const world = await disableWorld();
  const refused = await refusedAs(world, 'repoAdmin1', world.t1.scoped.repositoryId);
  expect([refused.statusCode, errorCodeOf(refused)]).toEqual([403, 'forbidden']);
});

test('the admin of one repository is 403 for another repository of the installation, whatever it enforces', async () => {
  const world = await disableWorld();
  const response = await refusedAs(world, 'repoAdmin1', world.t1.plain.repositoryId);
  expect([response.statusCode, errorCodeOf(response)]).toEqual([403, 'forbidden']);
});

test('the role is judged before the state: the refused admin of a repository that is off already is told 403, not changed false', async () => {
  const world = await disableWorld();
  await setEnabled(world, world.t1.scoped.repositoryId, false);
  const refused = await refusedAs(world, 'repoAdmin1', world.t1.scoped.repositoryId);
  expect([refused.statusCode, errorCodeOf(refused)]).toEqual([403, 'forbidden']);
});

test('a person with no role in the installation gets the 404 of an unknown repository, byte for byte', async () => {
  const world = await disableWorld();
  const unknown = await disableAs(world, 'admin1', 987_654);
  const answers = [
    await refusedAs(world, 'member1', world.t1.plain.repositoryId),
    await refusedAs(world, 'outsider', world.t1.plain.repositoryId),
    await refusedAs(world, 'admin2', world.t1.plain.repositoryId),
  ];
  expect(answers.map((answer) => answer.statusCode)).toEqual([404, 404, 404]);
  expect(answers.map(withoutRequestId)).toEqual(answers.map(() => withoutRequestId(unknown)));
});

test('a suspended installation refuses the call with 409 installation_suspended, also for the org admin the ledger remembers, and changes nothing', async () => {
  const world = await disableWorld();
  await suspendTenantOne(world);
  const audited = (await auditRows(world, 'repository.disabled')).length;
  const response = await refusedAs(world, 'admin1', world.t1.plain.repositoryId);
  expect([response.statusCode, errorCodeOf(response)]).toEqual([409, 'installation_suspended']);
  expect(await auditRows(world, 'repository.disabled')).toHaveLength(audited);
});
