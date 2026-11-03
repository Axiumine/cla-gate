// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { toStoredDetails } from '../../domain/evaluation/stored-details.ts';
import { pullRef } from '../github-comment-contract/test-support.ts';
import { listed, MOVED, NAMES, PASSING, type ReportingWorld, reportingWorld, withoutTrigger } from './test-support.ts';

// What becomes of the run of a SHA when a pull request that shares it ends without a verdict (E09-S06): closed, or superseded by a
// newer commit. Another pull request may have finished meanwhile and left the run `in_progress` for this one's end to settle.

const methods = (fake: { calls: readonly { method: string }[] }): string[] => fake.calls.map((call) => call.method);

/** Pull requests 7 and 8 started at the same SHA, 7 passed and published while 8 was still being evaluated: the run is `in_progress`. */
async function sevenPublishedWhileEightRuns(world: ReportingWorld) {
  const seven = await world.evaluation();
  const eight = await world.evaluation({ prNumber: 8 });
  listed(world, pullRef(7), pullRef(8));
  await world.reporter.started(seven);
  await world.reporter.started(eight);
  await world.settle(7, 'success', toStoredDetails(PASSING));
  await world.reporter.publish(seven, PASSING, NAMES);
  expect(world.fake.checkRuns[0]?.write).toMatchObject({ status: 'in_progress' });
  return { seven, eight };
}

test.each([
  ['closed', { state: 'closed' }],
  ['open at another head SHA, which is what the reaper finds of a superseded evaluation', { headSha: MOVED }],
] as const)(
  'when the pull request still running at the SHA is %s, the run is completed with what the pull request that finished said',
  async (_how, listing) => {
    const world = await reportingWorld();
    const { eight } = await sevenPublishedWhileEightRuns(world);
    listed(world, pullRef(7), pullRef(8, listing));
    await world.reporter.cancelled(withoutTrigger(eight));
    expect(world.fake.checkRuns).toHaveLength(1);
    expect(world.fake.checkRuns[0]?.run.status).toBe('completed');
    expect(world.fake.checkRuns[0]?.write).toMatchObject({ conclusion: 'success', title: 'CLA check passed' });
    expect(world.fake.checkRuns[0]?.write?.summary).toContain('1 contributor covered: 1 by signature.');
  },
);

test('when a pull request that finished failed, the run is completed as failing, with no name', async () => {
  const world = await reportingWorld();
  const { eight } = await sevenPublishedWhileEightRuns(world);
  await world.settle(7, 'failure');
  listed(world, pullRef(7), pullRef(8, { state: 'closed' }));
  await world.reporter.cancelled(withoutTrigger(eight));
  expect(world.fake.checkRuns[0]?.write).toMatchObject({
    status: 'completed',
    conclusion: 'failure',
    title: 'CLA check failed',
  });
});

test('when another pull request is still being evaluated at the SHA, the run is left running for it to finish', async () => {
  const world = await reportingWorld();
  const { eight } = await sevenPublishedWhileEightRuns(world);
  await world.evaluation({ prNumber: 9 });
  listed(world, pullRef(7), pullRef(8, { state: 'closed' }), pullRef(9));
  const writes = world.fake.checkRunWrites.length;
  await world.reporter.cancelled(withoutTrigger(eight));
  expect(world.fake.checkRunWrites).toHaveLength(writes);
  expect(world.fake.checkRuns[0]?.write).toMatchObject({ status: 'in_progress' });
  expect(world.logs.lines().map((line) => line['msg'])).toContain('report.cancel_left_to_sibling');
});

test('when the details of the pull request that finished cannot be read, the run still completes, with no count', async () => {
  const world = await reportingWorld();
  const { eight } = await sevenPublishedWhileEightRuns(world);
  await world.settle(7, 'success', { not: 'details' });
  listed(world, pullRef(7), pullRef(8, { state: 'closed' }));
  await world.reporter.cancelled(withoutTrigger(eight));
  expect(world.fake.checkRuns[0]?.write).toMatchObject({ status: 'completed', conclusion: 'success' });
  expect(world.fake.checkRuns[0]?.write?.summary).toContain('0 contributors covered.');
});

test('a pull request that closes with no other pull request open at the SHA still ends the run cancelled', async () => {
  const world = await reportingWorld();
  const { eight } = await sevenPublishedWhileEightRuns(world);
  await world.settle(7, 'success', toStoredDetails(PASSING));
  listed(world, pullRef(7, { state: 'closed' }), pullRef(8, { state: 'closed' }));
  await world.reporter.cancelled(withoutTrigger(eight));
  expect(world.fake.checkRuns[0]?.write).toMatchObject({ status: 'completed', conclusion: 'cancelled' });
});

test('a run that is completed already is left alone, and GitHub is not asked which pull requests are open', async () => {
  const world = await reportingWorld();
  const { eight } = await sevenPublishedWhileEightRuns(world);
  await world.settle(8, 'success', toStoredDetails(PASSING));
  await world.reporter.publish(eight, PASSING, NAMES);
  expect(world.fake.checkRuns[0]?.run.status).toBe('completed');
  const calls = world.fake.calls.length;
  await world.reporter.cancelled(withoutTrigger(eight));
  expect(methods(world.fake).slice(calls)).toEqual(['getCheckRun']);
});
