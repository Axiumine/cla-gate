// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { createLogger } from '../../adapters/http/logger.ts';
import { type EvaluateWorld, evaluateWorld } from '../evaluate-pr/test-support.ts';
import { CheckRunReporter } from '../reporting/check-run-reporter.ts';
import { CheckRunWriter } from '../reporting/check-run-writer.ts';
import { evaluateMergeGroup } from './evaluate-merge-group.ts';
import { addGroup, failFor, groupJob, groupRows, secondTenant } from './test-support.ts';

// Tenancy of the merge group job (E22-S01), with the real reporter over the FakeGitHub: two tenants that have a group at the very
// same head SHA (the same commits, since a test GitHub numbers them alike) get a row and a Check Run each, and neither verdict
// reaches the other.

const APP = parseGithubId(4242);

/** Runs the job of `job` with the ports of `world` and the reporter that writes Check Runs, as the worker does. */
async function runWithRealReporter(world: EvaluateWorld, job: ReturnType<typeof groupJob>) {
  const logger = createLogger({ logLevel: 'info' }, world.logs.destination);
  const github = world.fake;
  const writer = new CheckRunWriter({ github, appId: APP, clock: world.ports.clock, logger });
  const reporter = new CheckRunReporter({
    db: world.raw,
    github,
    writer,
    appId: APP,
    publicBaseUrl: 'https://cla.example.org',
    logger,
  });
  return evaluateMergeGroup({ ...world.ports, reporter }, job, { logger });
}

test('the same head SHA in the repositories of two tenants gives two rows and two Check Runs, each recorded on its own row', async () => {
  const world = await evaluateWorld();
  const other = await secondTenant(world);
  const mine = addGroup(world, [41]);
  const theirs = addGroup(world, [41], other);
  expect(theirs.head).toBe(mine.head);
  expect(await runWithRealReporter(world, groupJob(mine))).toEqual({ outcome: 'evaluated' });
  expect(await runWithRealReporter(world, groupJob(theirs))).toEqual({ outcome: 'evaluated' });
  const rows = await groupRows(world);
  expect(rows.map((row) => [row.head_sha, row.result])).toEqual([
    [mine.head, 'success'],
    [mine.head, 'success'],
  ]);
  expect(new Set(rows.map((row) => row.installation_id)).size).toBe(2);
  const runs = world.fake.checkRuns;
  expect(runs.map((run) => [run.installationId, run.fullName, run.run.headSha])).toEqual([
    [mine.installation, mine.fullName.toLowerCase(), mine.head],
    [theirs.installation, theirs.fullName.toLowerCase(), mine.head],
  ]);
  expect(runs.map((run) => run.write?.conclusion)).toEqual(['success', 'success']);
  expect(rows.map((row) => row.check_run_id)).toEqual(runs.map((run) => run.run.id));
  expect(runs.map((run) => run.run.externalId)).toEqual(rows.map((row) => String(row.id)));
});

test('a failure of one tenant at a head SHA that another also has is not the verdict of the other', async () => {
  const world = await evaluateWorld();
  const other = await secondTenant(world);
  const mine = addGroup(world, [41]);
  const theirs = addGroup(world, [42], other);
  failFor(world, [41]);
  await runWithRealReporter(world, groupJob(mine));
  await runWithRealReporter(world, groupJob(theirs));
  expect((await groupRows(world)).map((row) => row.result)).toEqual(['failure', 'success']);
  const [first, second] = world.fake.checkRuns;
  expect(first?.write).toMatchObject({ conclusion: 'failure' });
  expect(first?.write?.summary).toContain('`PR 41`');
  expect(second?.write).toMatchObject({ conclusion: 'success' });
  expect(second?.write?.summary).not.toContain('PR 41');
});

test('a destroyed group of one tenant does not stop the group of the other at the same head SHA', async () => {
  const world = await evaluateWorld();
  const other = await secondTenant(world);
  const mine = addGroup(world, [41]);
  const theirs = addGroup(world, [41], other);
  await runWithRealReporter(world, groupJob(mine));
  await runWithRealReporter(world, groupJob(theirs));
  await world.raw
    .updateTable('merge_group_evaluations')
    .set({ destroyed_at: new Date('2026-11-02T10:00:00Z') })
    .where('installation_id', '=', world.tenant.installationId)
    .execute();
  expect(await runWithRealReporter(world, groupJob(mine))).toEqual({ outcome: 'skipped:merge_group_destroyed' });
  expect(await runWithRealReporter(world, groupJob(theirs))).toEqual({ outcome: 'evaluated' });
  expect(world.fake.checkRunWrites.map((write) => [write.kind, write.write.conclusion])).toEqual([
    ['create', 'success'],
    ['create', 'success'],
    ['update', 'success'],
  ]);
});
