// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { corporateAvailable } from '../../services/corporate-claim.ts';
import { revokeSignature, suspendTenantOne } from './corporate-approval-fixture/test-support.ts';
import {
  availabilityAs,
  availableOf,
  claimWorld,
  unsignedCorporateRepository,
} from './corporate-claim-fixture/test-support.ts';
import { failureOf, publishMajor, signAs, signerWith } from './corporate-fixture/test-support.ts';

// Whether a repository offers the claim of an employee (E21-S04): true only when it has a corporate CLA in force and at least one agreement
// under it that is in force; false for everything else, and never a company, an agreement or a tenant named in the answer.

test('the world starts with one agreement for each tenant, so both plain repositories offer the claim', async () => {
  const world = await claimWorld();
  expect(availableOf(await availabilityAs(world, world.ada, world.t1.plain.githubRepoId))).toBe(true);
  expect(availableOf(await availabilityAs(world, world.ada, world.t2.plain.githubRepoId))).toBe(true);
});

test('the answer is exactly one flag: no company, no agreement, no tenant, no number', async () => {
  const world = await claimWorld();
  const response = await availabilityAs(world, world.ada, world.t1.plain.githubRepoId);
  expect(response.body).toBe('{"corporateAvailable":true}');
  expect(response.headers['cache-control']).toBe('no-store');
});

test('a repository whose corporate CLA has no agreement under it is not available, though another repository of the tenant is', async () => {
  const world = await claimWorld();
  await unsignedCorporateRepository(world);
  expect(availableOf(await availabilityAs(world, world.ada, world.t1.scoped.githubRepoId))).toBe(false);
  expect(availableOf(await availabilityAs(world, world.ada, world.t1.plain.githubRepoId))).toBe(true);
});

test('a repository with no corporate document, one that is not enabled, one that does not exist and one of a tenant that is gone are all false', async () => {
  const world = await claimWorld();
  expect(availableOf(await availabilityAs(world, world.ada, world.t1.scoped.githubRepoId))).toBe(false);
  expect(availableOf(await availabilityAs(world, world.ada, 987_654))).toBe(false);
  await world.db
    .updateTable('repositories')
    .set({ enabled: false })
    .where('id', '=', world.t1.plain.repositoryId)
    .execute();
  expect(availableOf(await availabilityAs(world, world.ada, world.t1.plain.githubRepoId))).toBe(false);
  await world.db
    .updateTable('installations')
    .set({ deleted_at: new Date('2026-10-01T00:00:00Z') })
    .where('id', '=', world.t2.installationId)
    .execute();
  expect(availableOf(await availabilityAs(world, world.ada, world.t2.plain.githubRepoId))).toBe(false);
});

test('an agreement whose signature was revoked does not make the repository available, and the other agreements of the tenant still do', async () => {
  const world = await claimWorld();
  const dana = await signerWith(world, 4400);
  const second = await signAs(world, dana, world.c1, { typedName: 'Dana Example', companyName: 'Dana Ltd' });
  await revokeSignature(world, world.adas.signatureId);
  expect(availableOf(await availabilityAs(world, world.ada, world.t1.plain.githubRepoId))).toBe(true);
  await revokeSignature(world, second.signatureId);
  expect(availableOf(await availabilityAs(world, world.ada, world.t1.plain.githubRepoId))).toBe(false);
});

test('an agreement signed under an earlier major is not available once a new major is in force, and one under the new major is', async () => {
  const world = await claimWorld();
  const next = await publishMajor(world, world.c1, 2);
  expect(availableOf(await availabilityAs(world, world.ada, world.t1.plain.githubRepoId))).toBe(false);
  expect(availableOf(await availabilityAs(world, world.ada, world.t2.plain.githubRepoId))).toBe(true);
  const dana = await signerWith(world, 4400);
  await signAs(world, dana, world.c1, {
    typedName: 'Dana Example',
    versionId: next.versionId,
    contentSha256: next.contentSha256,
  });
  expect(availableOf(await availabilityAs(world, world.ada, world.t1.plain.githubRepoId))).toBe(true);
});

test('the agreements of one tenant never make the repository of another available', async () => {
  const world = await claimWorld();
  await revokeSignature(world, world.adas.signatureId);
  expect(availableOf(await availabilityAs(world, world.ada, world.t1.plain.githubRepoId))).toBe(false);
  expect(availableOf(await availabilityAs(world, world.ada, world.t2.plain.githubRepoId))).toBe(true);
});

test('a suspended tenant is read as usual, and nothing is sent to GitHub: the answer is the database alone', async () => {
  const world = await claimWorld();
  await suspendTenantOne(world);
  expect(availableOf(await availabilityAs(world, world.ada, world.t1.plain.githubRepoId))).toBe(true);
  expect(world.github.calls).toEqual([]);
});

test('without a session the answer is a 401, and the id in the path must be plain digits', async () => {
  const world = await claimWorld();
  expect(failureOf(await availabilityAs(world, null, world.t1.plain.githubRepoId))).toEqual([401, 'unauthorized']);
  for (const id of ['0', '01', '1e3', '-4', 'abc', '1.5']) {
    expect(failureOf(await availabilityAs(world, world.ada, id)), id).toEqual([400, 'bad_request']);
  }
});

test('a database that fails is not an answer of false: the failure is thrown, and the route answers it as a server error that names nothing', async () => {
  const world = await claimWorld();
  await sql`alter table corporate_agreements rename to corporate_agreements_gone`.execute(world.db);
  await expect(corporateAvailable(world.db, world.t1.plain.githubRepoId)).rejects.toThrow('corporate_agreements');
  const response = await availabilityAs(world, world.ada, world.t1.plain.githubRepoId);
  expect(failureOf(response)).toEqual([500, 'internal_server_error']);
  expect(response.body).not.toContain('corporate_agreements');
});
