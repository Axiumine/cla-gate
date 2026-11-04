// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { jobCount } from '../../services/jobs-fixture/test-support.ts';
import { auditRows, errorCodeOf, parsed, tablesOf, withoutRequestId } from './document-fixture/test-support.ts';
import {
  pointAt,
  publish,
  repositoryState,
  setEnabled,
  suspendTenantOne,
} from './repository-document-fixture/test-support.ts';
import { enableAs, enabledAnswerOf, enableWorld } from './repository-enable-fixture/test-support.ts';

// The rules that refuse turning enforcement on (E14-S03): a repository with no published CLA, a role that is too low for the document
// the repository enforces, a person with no role, and a tenant that is away. Each refusal leaves every tenant table as it was and
// sends no job.

/** Asks as `who` and checks that the call changed no tenant table and sent no job. */
async function refusedAs(
  world: Awaited<ReturnType<typeof enableWorld>>,
  who: Parameters<typeof enableAs>[1],
  repositoryId: number,
) {
  const before = await tablesOf(world);
  const response = await enableAs(world, who, repositoryId);
  expect(await tablesOf(world)).toEqual(before);
  expect(await jobCount(world.db)).toBe(0);
  return response;
}

test('a repository with no document attached is 409 no_active_cla, with the fix in the hint', async () => {
  const world = await enableWorld();
  await pointAt(world, world.t1.plain.repositoryId, null);
  const response = await refusedAs(world, 'admin1', world.t1.plain.repositoryId);
  expect([response.statusCode, errorCodeOf(response)]).toEqual([409, 'no_active_cla']);
  const hint = parsed(response, errorResponseSchema).error.details?.['hint'];
  expect(hint).toBe(
    'Attach a CLA document to this repository and publish a version of it first, then enable the repository.',
  );
  expect((await repositoryState(world, world.t1.plain.repositoryId)).enabled).toBe(false);
});

test('a repository whose document has no published version is 409 no_active_cla too, and enabling works once it is published', async () => {
  const world = await enableWorld();
  const { t1 } = world;
  await pointAt(world, t1.scoped.repositoryId, t1.scoped.documentId);
  await setEnabled(world, t1.scoped.repositoryId, false);
  const refused = await refusedAs(world, 'admin1', t1.scoped.repositoryId);
  expect([refused.statusCode, errorCodeOf(refused)]).toEqual([409, 'no_active_cla']);
  await publish(world, t1.scoped.documentId);
  const allowed = await enableAs(world, 'admin1', t1.scoped.repositoryId);
  expect([allowed.statusCode, enabledAnswerOf(allowed).changed]).toEqual([200, true]);
});

test("the admin of a repository whose document is the organisation's is 403 forbidden, and an org admin is let in by the same call", async () => {
  const world = await enableWorld();
  const { t1 } = world;
  await pointAt(world, t1.scoped.repositoryId, t1.documentId);
  await setEnabled(world, t1.scoped.repositoryId, false);
  const refused = await refusedAs(world, 'repoAdmin1', t1.scoped.repositoryId);
  expect([refused.statusCode, errorCodeOf(refused)]).toEqual([403, 'forbidden']);
  const org = await enableAs(world, 'admin1', t1.scoped.repositoryId);
  expect([org.statusCode, enabledAnswerOf(org).changed]).toEqual([200, true]);
});

test('the role decides what a person learns: the admin of a repository with no document is told 403, not that there is no CLA', async () => {
  const world = await enableWorld();
  const { t1 } = world;
  await setEnabled(world, t1.scoped.repositoryId, false);
  const refused = await refusedAs(world, 'repoAdmin1', t1.scoped.repositoryId);
  expect([refused.statusCode, errorCodeOf(refused)]).toEqual([403, 'forbidden']);
});

test('the admin of one repository is 403 for another repository of the installation, whatever it enforces', async () => {
  const world = await enableWorld();
  const response = await refusedAs(world, 'repoAdmin1', world.t1.plain.repositoryId);
  expect([response.statusCode, errorCodeOf(response)]).toEqual([403, 'forbidden']);
});

test('a person with no role in the installation gets the 404 of an unknown repository, byte for byte', async () => {
  const world = await enableWorld();
  const unknown = await enableAs(world, 'admin1', 987_654);
  const answers = [
    await refusedAs(world, 'member1', world.t1.plain.repositoryId),
    await refusedAs(world, 'outsider', world.t1.plain.repositoryId),
    await refusedAs(world, 'admin2', world.t1.plain.repositoryId),
  ];
  expect(answers.map((answer) => answer.statusCode)).toEqual([404, 404, 404]);
  expect(answers.map(withoutRequestId)).toEqual(answers.map(() => withoutRequestId(unknown)));
});

test('a suspended installation refuses the call with 409 installation_suspended, also for the org admin the ledger remembers, and changes nothing', async () => {
  const world = await enableWorld();
  await suspendTenantOne(world);
  const response = await refusedAs(world, 'admin1', world.t1.plain.repositoryId);
  expect([response.statusCode, errorCodeOf(response)]).toEqual([409, 'installation_suspended']);
  expect(await auditRows(world, 'repository.enabled')).toHaveLength(2);
});
