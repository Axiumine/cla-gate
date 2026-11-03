// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { insertEvaluation } from '../../adapters/db/pr-evaluation-links-fixture/test-support.ts';
import { TenantMismatchError } from '../../adapters/db/tenant-scope.ts';
import { seedTenant } from '../../adapters/db/test-support.ts';
import { HEAD, NAMES, PASSING, reportingWorld } from './test-support.ts';

// Tenancy of the reporter (E09-S05): a report names an installation and a repository by their GitHub ids, and the database
// must hold them together before anything is read, written or sent to GitHub. Tenant 2 (installation 10000, repository 18000)
// has a pull request 7 at the same head SHA as tenant 1.

test.each([
  ['an installation the database does not hold', { githubInstallationId: parseGithubId(31_337) }],
  ['a repository of another installation', { githubRepoId: parseGithubId(18_000) }],
  ['a repository nobody holds', { githubRepoId: parseGithubId(31_337) }],
])('a report naming %s is refused before any GitHub call, and no row changes', async (_name, overrides) => {
  const world = await reportingWorld();
  const other = await seedTenant(world.db, 2);
  await insertEvaluation(world.db, other, { prNumber: 7, headSha: HEAD });
  const target = { ...(await world.evaluation()), ...overrides };
  const before = await world.rows();
  await expect(world.reporter.started(target)).rejects.toBeInstanceOf(TenantMismatchError);
  await expect(world.reporter.publish(target, PASSING, NAMES)).rejects.toBeInstanceOf(TenantMismatchError);
  expect(world.fake.calls).toEqual([]);
  expect(await world.rows()).toEqual(before);
});

test('the rows of another tenant at the same pull request number and head SHA are neither read nor written', async () => {
  const world = await reportingWorld();
  const other = await seedTenant(world.db, 2);
  await insertEvaluation(world.db, other, { prNumber: 8, headSha: HEAD, result: 'failure', checkRunId: 4242 });
  const target = await world.evaluation({ result: 'success' });
  await world.reporter.started(target);
  await world.reporter.publish(target, PASSING, NAMES);
  expect(world.fake.checkRuns[0]?.write).toMatchObject({ conclusion: 'success', title: 'CLA check passed' });
  const rows = await world.rows();
  expect(rows.map((row) => [row.installation_id, row.pr_number, row.check_run_id])).toEqual([
    [other.installationId, 8, 4242],
    [world.tenant.installationId, 7, world.fake.checkRuns[0]?.run.id],
  ]);
});
