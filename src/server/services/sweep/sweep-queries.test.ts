// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { rowId } from '../../adapters/db/test-support.ts';
import { listServedInstallationIds } from '../installation-queries.ts';
import { listEnabledRepositories } from '../repository-queries.ts';
import { evaluationKey, evaluationStates, staleEvaluations } from './sweep-rows.ts';
import { addNeighbour, HEAD, MINUTE, NEWER_HEAD, seedAged, sweepWorld } from './test-support.ts';

// The statements the sweep (E07-S08) reads with, each against two tenants: none of them may return a row of the other.

test('the installations served are the admitted ones that are neither suspended nor deleted, in the order of their GitHub id', async () => {
  const world = await sweepWorld();
  await addNeighbour(world, 4);
  await addNeighbour(world, 2, { admission: 'rejected' });
  await addNeighbour(world, 3, { suspended: true });
  await addNeighbour(world, 5, { deleted: true });
  expect(await listServedInstallationIds(world.raw)).toEqual([parseGithubId(5000), parseGithubId(20_000)]);
});

test('the repositories listed are those of the installation with enforcement on that it still has, and none of another installation', async () => {
  const world = await sweepWorld();
  await addNeighbour(world, 2);
  await world.raw
    .insertInto('repositories')
    .values([
      {
        installation_id: world.tenant.installationId,
        github_repo_id: 9001,
        full_name: 'org-1/off',
        enabled: false,
        cla_document_id: null,
      },
      {
        installation_id: world.tenant.installationId,
        github_repo_id: 9002,
        full_name: 'org-1/gone',
        enabled: true,
        removed_at: new Date('2026-11-01T09:30:00Z'),
        cla_document_id: null,
      },
    ])
    .execute();
  expect((await listEnabledRepositories(world.raw, world.tenant.installationId)).map((row) => row.full_name)).toEqual([
    'org-1/repo',
  ]);
  expect(await listEnabledRepositories(world.raw, rowId(world.tenant.installationId + 10_000))).toEqual([]);
});

test('the stored evaluations of the listed pull requests are found by pull request and head SHA, across the batches of a long list', async () => {
  const world = await sweepWorld();
  await seedAged(world, { prNumber: 1, headSha: HEAD, result: 'success' });
  await seedAged(world, { prNumber: 1, headSha: NEWER_HEAD, result: 'in_progress', ageMinutes: 7 });
  await seedAged(world, { prNumber: 700, headSha: HEAD, result: 'failure' });
  await seedAged(world, { prNumber: 701, headSha: HEAD, result: 'cancelled' });
  const numbers = Array.from({ length: 700 }, (_unused, index) => index + 1);
  const states = await evaluationStates(
    world.raw,
    { installationId: world.tenant.installationId, repositoryId: world.tenant.repositoryId },
    numbers,
  );
  expect(states.get(evaluationKey(1, HEAD))?.result).toBe('success');
  expect(states.get(evaluationKey(1, NEWER_HEAD))).toEqual({
    result: 'in_progress',
    updatedAtMs: world.clock.now().getTime() - 7 * MINUTE,
  });
  expect(states.get(evaluationKey(700, HEAD))?.result).toBe('failure');
  expect(states.has(evaluationKey(701, HEAD))).toBe(false);
  expect(states.size).toBe(3);
});

test('no evaluation of another tenant, with the same pull request number and head SHA, is found', async () => {
  const world = await sweepWorld();
  await addNeighbour(world, 2);
  const other = await world.raw
    .selectFrom('installations')
    .select('id')
    .where('github_installation_id', '=', 10_000)
    .executeTakeFirstOrThrow();
  const otherRepository = await world.raw
    .selectFrom('repositories')
    .select('id')
    .where('installation_id', '=', other.id)
    .executeTakeFirstOrThrow();
  await world.raw
    .insertInto('pr_evaluations')
    .values({
      installation_id: other.id,
      repository_id: otherRepository.id,
      pr_number: 7,
      head_sha: HEAD,
      result: 'success',
    })
    .execute();
  const scope = { installationId: world.tenant.installationId, repositoryId: world.tenant.repositoryId };
  expect((await evaluationStates(world.raw, scope, [7])).size).toBe(0);
  expect(
    (
      await evaluationStates(
        world.raw,
        { installationId: rowId(other.id), repositoryId: world.tenant.repositoryId },
        [7],
      )
    ).size,
  ).toBe(0);
});

test('the stale evaluations are those in progress and last touched before the cutoff, of the repository asked for', async () => {
  const world = await sweepWorld();
  const old = await seedAged(world, { prNumber: 1, headSha: HEAD, result: 'in_progress', ageMinutes: 45 });
  await seedAged(world, { prNumber: 2, headSha: HEAD, result: 'in_progress', ageMinutes: 29 });
  await seedAged(world, { prNumber: 3, headSha: HEAD, result: 'success', ageMinutes: 600 });
  await seedAged(world, { prNumber: 4, headSha: HEAD, result: 'cancelled', ageMinutes: 600 });
  const scope = { installationId: world.tenant.installationId, repositoryId: world.tenant.repositoryId };
  const cutoff = new Date(world.clock.now().getTime() - 30 * MINUTE);
  expect(await staleEvaluations(world.raw, scope, cutoff)).toEqual([{ id: old, prNumber: 1, headSha: HEAD }]);
  expect(await staleEvaluations(world.raw, { ...scope, repositoryId: scope.repositoryId + 1 }, cutoff)).toEqual([]);
  expect(
    await staleEvaluations(world.raw, { ...scope, installationId: rowId(scope.installationId + 1) }, cutoff),
  ).toEqual([]);
  expect(await staleEvaluations(world.raw, scope, new Date(world.clock.now().getTime() - 29 * MINUTE))).toHaveLength(1);
});
