// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { asRuntimeRole, seedSignature, seedTenant } from '../../adapters/db/test-support.ts';
import { createLogger } from '../../adapters/http/logger.ts';
import { commitSha } from '../github-pull-contract/test-support.ts';
import { createOrgMembership } from '../org-membership.ts';
import { evaluatePr } from './evaluate-pr.ts';
import { allow, type EvaluateWorld, engineInput, enrol, evaluateWorld, JOB, lookups, ORG } from './test-support.ts';

// Tenancy (E07-S04): the job of one installation reads and writes nothing of another. Tenant 2 is the neighbour: it has
// people who signed, an allowlist and overrides that would change the verdict of tenant 1 if they ever reached it.

/** Everything tenant 2 has that could reach the verdict of tenant 1, on the same people and the same commits. */
async function neighbour(world: EvaluateWorld) {
  const other = await seedTenant(world.raw, 2);
  for (const person of [7, 1, 2]) {
    await seedSignature(world.raw, other, person);
  }
  await world.raw
    .insertInto('allowlist_entries')
    .values([
      {
        installation_id: other.installationId,
        repository_id: null,
        kind: 'user',
        github_id: 7,
        created_by: other.publisherId,
      },
      {
        installation_id: other.installationId,
        repository_id: null,
        kind: 'org_members',
        github_id: 14_000,
        created_by: other.publisherId,
      },
    ])
    .execute();
  await world.raw
    .insertInto('commit_overrides')
    .values({
      installation_id: other.installationId,
      repository_id: other.repositoryId,
      commit_sha: commitSha(1),
      created_by: other.publisherId,
      reason: 'a note of tenant 2',
    })
    .execute();
  return other;
}

test('the signatures, the allowlist and the overrides of another installation never reach the engine', async () => {
  const world = await evaluateWorld();
  await neighbour(world);
  await world.run();
  const input = engineInput(world);
  expect(input.signatures).toEqual([]);
  expect(input.allowlist).toEqual([]);
  expect(input.overrides).toEqual(new Map());
  expect(input.orgMembers).toEqual(new Map());
});

test('the facts of the installation itself are the ones that reach the engine, next to those of the neighbour', async () => {
  const world = await evaluateWorld();
  await neighbour(world);
  await seedSignature(world.raw, world.tenant, 3_001);
  await allow(world, { kind: 'user', githubId: 7 });
  await world.run();
  expect(engineInput(world).allowlist.map((entry) => [entry.kind, entry.githubId, entry.scope])).toEqual([
    ['user', 7, 'installation'],
  ]);
  expect(engineInput(world).signatures).toEqual([]);
});

test('the neighbour is not asked about, and its repository, its rows and its signatures stay as they were', async () => {
  const world = await evaluateWorld();
  const other = await neighbour(world);
  await allow(world, { kind: 'org_members', githubId: ORG });
  enrol(world, 7);
  const before = await world.raw
    .selectFrom('signatures')
    .select('id')
    .where('installation_id', '=', other.installationId)
    .execute();
  await world.run();
  expect(lookups(world)).toBe(3);
  const evaluations = await world.raw
    .selectFrom('pr_evaluations')
    .select(['installation_id', 'repository_id'])
    .execute();
  expect(evaluations).toEqual([
    { installation_id: world.tenant.installationId, repository_id: world.tenant.repositoryId },
  ]);
  expect(
    await world.raw.selectFrom('signatures').select('id').where('installation_id', '=', other.installationId).execute(),
  ).toEqual(before);
});

test('the job runs as the runtime role: it reads what it needs and writes its row, nothing more', async () => {
  const world = await evaluateWorld({ runtime: true, engine: true });
  await seedSignature(world.raw, world.tenant, 7);
  const logger = createLogger({ logLevel: 'info' }, world.logs.destination);
  const outcome = await asRuntimeRole(world.raw, (trx) =>
    evaluatePr(
      { ...world.ports, db: trx, orgMembership: createOrgMembership({ db: trx, github: world.fake, logger }) },
      JOB,
      { attempt: 0, logger },
    ),
  );
  expect(outcome).toEqual({ outcome: 'evaluated' });
  expect((await world.rows()).map((row) => row.result)).toEqual(['failure']);
  expect(world.reporter.published).toHaveLength(1);
});
