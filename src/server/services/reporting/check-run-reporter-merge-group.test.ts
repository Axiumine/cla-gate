// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { z } from 'zod';
import { parseGithubId } from '../../../shared/github-id.ts';
import { TenantMismatchError } from '../../adapters/db/tenant-scope.ts';
import { seedTenant } from '../../adapters/db/test-support.ts';
import { line, type RouteCall } from '../../adapters/github/client-fixture/test-support.ts';
import { UNDETERMINED_SUMMARY } from '../../domain/reporting/merge-group-output.ts';
import { commitSha } from '../github-pull-contract/test-support.ts';
import { GroupRowMissingError, startGroupEvaluation } from '../merge-group/merge-group-rows.ts';
import { InstallationGoneError } from '../ports/github-errors.ts';
import type { MergeGroupTarget } from '../ports/reporter.ts';
import { created, inOrder, POST, RUN, refused, scripted } from './scripted-github/test-support.ts';
import { FULL_NAME, INSTALLATION, REPOSITORY, type ReportingWorld, reportingWorld } from './test-support.ts';

// The Check Run of a merge group (E22-S01), written by the reporter through the same upsert as the run of a pull request: on the
// head SHA of the group, found through the tenant, with the id of the run kept on the row of the group.

/** The head SHA of the group, which no pull request has. */
const GROUP_HEAD = commitSha(0x6001);
const GROUP_BASE = commitSha(0x5000);

const target = (overrides: Partial<MergeGroupTarget> = {}): MergeGroupTarget => ({
  githubInstallationId: INSTALLATION,
  githubRepoId: REPOSITORY,
  fullName: FULL_NAME,
  headSha: GROUP_HEAD,
  ...overrides,
});

/** Stores the row of the group of the world's tenant, as the job does before it reports. */
async function storeGroup(world: ReportingWorld, headSha = GROUP_HEAD) {
  const row = await startGroupEvaluation(
    world.db,
    { installationId: world.tenant.installationId, repositoryId: world.tenant.repositoryId, headSha },
    GROUP_BASE,
  );
  return row?.id ?? 0;
}

const groupRows = (world: ReportingWorld) =>
  world.db.selectFrom('merge_group_evaluations').select(['id', 'head_sha', 'check_run_id']).orderBy('id').execute();

test('a passing group creates one completed run on the head SHA of the group, and the row records its id', async () => {
  const world = await reportingWorld();
  const id = await storeGroup(world);
  expect(await world.reporter.mergeGroup(target(), { state: 'passed', pullRequests: 2 })).toEqual({
    status: 'reported',
  });
  expect(world.fake.checkRuns).toHaveLength(1);
  const [run] = world.fake.checkRuns;
  expect(run?.run.headSha).toBe(GROUP_HEAD);
  expect(run?.write).toMatchObject({
    status: 'completed',
    conclusion: 'success',
    title: 'CLA check passed',
    externalId: String(id),
  });
  expect(run?.write?.summary).toContain('All 2 pull requests in this merge group are covered by the CLA.');
  expect(await groupRows(world)).toEqual([{ id, head_sha: GROUP_HEAD, check_run_id: run?.run.id }]);
});

test('a failing group lists its pull requests as PR n in code spans, never as #n, and the conclusion is failure', async () => {
  const world = await reportingWorld();
  await storeGroup(world);
  await world.reporter.mergeGroup(target(), { state: 'failed', failing: [12, 7] });
  const [run] = world.fake.checkRuns;
  expect(run?.write).toMatchObject({ conclusion: 'failure', title: 'CLA check failed' });
  expect(run?.write?.summary).toContain('- `PR 12`\n- `PR 7`');
  expect(run?.write?.summary).not.toContain('#');
});

test('a group whose pull requests are not known is a failure with the fixed sentence', async () => {
  const world = await reportingWorld();
  await storeGroup(world);
  await world.reporter.mergeGroup(target(), { state: 'undetermined' });
  expect(world.fake.checkRuns[0]?.write).toMatchObject({ conclusion: 'failure', summary: UNDETERMINED_SUMMARY });
});

test('a second report updates the run the row records: one run, one id, the new conclusion', async () => {
  const world = await reportingWorld();
  await storeGroup(world);
  await world.reporter.mergeGroup(target(), { state: 'failed', failing: [7] });
  await world.reporter.mergeGroup(target(), { state: 'passed', pullRequests: 1 });
  expect(world.fake.checkRuns).toHaveLength(1);
  expect(world.fake.checkRuns[0]?.run.headSha).toBe(GROUP_HEAD);
  expect(world.fake.checkRuns[0]?.write).toMatchObject({ conclusion: 'success' });
  expect((await groupRows(world)).map((row) => row.check_run_id)).toEqual([world.fake.checkRuns[0]?.run.id]);
});

test('a run the row does not know is found on the SHA before a new one is created', async () => {
  const world = await reportingWorld();
  await storeGroup(world);
  await world.reporter.mergeGroup(target(), { state: 'failed', failing: [7] });
  await world.db.updateTable('merge_group_evaluations').set({ check_run_id: null }).execute();
  await world.reporter.mergeGroup(target(), { state: 'passed', pullRequests: 1 });
  expect(world.fake.checkRuns).toHaveLength(1);
  expect((await groupRows(world)).map((row) => row.check_run_id)).toEqual([world.fake.checkRuns[0]?.run.id]);
});

test('the report is logged by numeric ids and the head SHA, with no pull request number', async () => {
  const world = await reportingWorld();
  await storeGroup(world);
  await world.reporter.mergeGroup(target(), { state: 'passed', pullRequests: 1 });
  const [entry] = world.logs.lines().filter((logged) => logged['msg'] === 'report.merge_group');
  expect(entry).toMatchObject({ githubInstallationId: INSTALLATION, githubRepoId: REPOSITORY, headSha: GROUP_HEAD });
  expect(entry).not.toHaveProperty('prNumber');
});

test.each([
  ['an installation the database does not hold', { githubInstallationId: parseGithubId(31_337) }],
  ['a repository of another installation', { githubRepoId: parseGithubId(18_000) }],
  ['a repository nobody holds', { githubRepoId: parseGithubId(31_337) }],
])('a group report naming %s is refused before any GitHub call, and no row changes', async (_name, overrides) => {
  const world = await reportingWorld();
  await seedTenant(world.db, 2);
  await storeGroup(world);
  const before = await groupRows(world);
  await expect(
    world.reporter.mergeGroup(target(overrides), { state: 'passed', pullRequests: 1 }),
  ).rejects.toBeInstanceOf(TenantMismatchError);
  expect(world.fake.calls).toEqual([]);
  expect(await groupRows(world)).toEqual(before);
});

test('a group of another tenant at the same head SHA is neither read nor written', async () => {
  const world = await reportingWorld();
  const other = await seedTenant(world.db, 2);
  const foreign = await startGroupEvaluation(
    world.db,
    { installationId: other.installationId, repositoryId: other.repositoryId, headSha: GROUP_HEAD },
    GROUP_BASE,
  );
  await expect(world.reporter.mergeGroup(target(), { state: 'passed', pullRequests: 1 })).rejects.toBeInstanceOf(
    GroupRowMissingError,
  );
  expect(world.fake.calls).toEqual([]);
  expect((await groupRows(world)).map((row) => [row.id, row.check_run_id])).toEqual([[foreign?.id, null]]);
});

test('a group with no row is a defect: GroupRowMissingError, and nothing is sent to GitHub', async () => {
  const world = await reportingWorld();
  await expect(world.reporter.mergeGroup(target(), { state: 'passed', pullRequests: 1 })).rejects.toBeInstanceOf(
    GroupRowMissingError,
  );
  expect(world.fake.calls).toEqual([]);
});

/** The body a request carried, as the adapter sent it. */
const sentBody = (call: RouteCall | undefined) => z.looseObject({}).parse(JSON.parse(call?.body ?? '{}'));

test('a 422 to the run of a group is followed by one POST with the same fixed output and conclusion', async () => {
  const { world, calls } = await scripted({ [POST]: inOrder(refused(422), created) });
  await storeGroup(world);
  expect(await world.reporter.mergeGroup(target(), { state: 'failed', failing: [7] })).toEqual({ status: 'reported' });
  const posts = calls.filter((call) => call.method === 'POST' && call.path.endsWith('/check-runs'));
  expect(posts).toHaveLength(2);
  const [first, second] = posts.map(sentBody);
  expect(second).toMatchObject({ head_sha: GROUP_HEAD, status: 'completed', conclusion: 'failure' });
  expect(second).toEqual(first);
  expect((await groupRows(world)).map((row) => row.check_run_id)).toEqual([RUN.id]);
  expect(calls.map(line).filter((request) => request.includes('/pulls'))).toEqual([]);
});

test('a group report for an installation the instance does not serve ends as skipped and records no run', async () => {
  const { world } = await scripted({}, { get: () => Promise.reject(new InstallationGoneError(INSTALLATION)) });
  await storeGroup(world);
  expect(await world.reporter.mergeGroup(target(), { state: 'passed', pullRequests: 1 })).toEqual({
    status: 'skipped',
    reason: 'installation_unavailable',
  });
  expect((await groupRows(world)).map((row) => row.check_run_id)).toEqual([null]);
});

test('a group GitHub took down before the report is written gets no run: the report ends as skipped and sends nothing', async () => {
  const world = await reportingWorld();
  await storeGroup(world);
  await world.db.updateTable('merge_group_evaluations').set({ destroyed_at: new Date() }).execute();
  expect(await world.reporter.mergeGroup(target(), { state: 'passed', pullRequests: 1 })).toEqual({
    status: 'skipped',
    reason: 'merge_group_destroyed',
  });
  expect(world.fake.calls).toEqual([]);
  expect(world.fake.checkRuns).toEqual([]);
  expect((await groupRows(world)).map((row) => row.check_run_id)).toEqual([null]);
});
