// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { toStoredDetails } from '../../domain/evaluation/stored-details.ts';
import { pullRef } from '../github-comment-contract/test-support.ts';
import { FAILING, listed, NAMES, PASSING, type ReportingWorld, reportingWorld, startTogether } from './test-support.ts';

const methods = (fake: { calls: readonly { method: string }[] }): string[] => fake.calls.map((call) => call.method);

// Two runs of one SHA, made by two pull requests that started at the same moment (E09-S05).

/** Pull requests 7 and 8 start together: each lists the runs of the SHA before either creates one, so each creates its own. */
async function startedTogether(world: ReportingWorld) {
  const seven = await world.evaluation();
  const eight = await world.evaluation({ prNumber: 8 });
  listed(world, pullRef(7), pullRef(8));
  await startTogether(world, [seven, eight]);
  expect(world.fake.checkRuns).toHaveLength(2);
  return { seven, eight };
}

test('the pull request that owns the newer run finishes first: when the other finishes, both runs end, the newer one too', async () => {
  const world = await reportingWorld();
  const { seven, eight } = await startedTogether(world);
  await world.settle(8, 'success', toStoredDetails(PASSING));
  await world.reporter.publish(eight, PASSING, NAMES);
  expect(world.fake.checkRuns.map((stored) => stored.run.status)).toEqual(['in_progress', 'in_progress']);
  await world.settle(7, 'success', toStoredDetails(PASSING));
  await world.reporter.publish(seven, PASSING, NAMES);
  expect(world.fake.checkRuns.map((stored) => [stored.run.status, stored.write?.conclusion])).toEqual([
    ['completed', 'success'],
    ['completed', 'success'],
  ]);
});

test('the pull request that owns the older run finishes first: the newer run is brought to the verdict at once', async () => {
  const world = await reportingWorld();
  const { seven } = await startedTogether(world);
  await world.settle(7, 'failure');
  await world.reporter.publish(seven, FAILING, NAMES);
  expect(world.fake.checkRuns.map((stored) => [stored.run.status, stored.write?.conclusion])).toEqual([
    ['completed', 'failure'],
    ['completed', 'failure'],
  ]);
});

test('the rows keep the run each pull request created: converging the newer run records nothing', async () => {
  const world = await reportingWorld();
  const { seven, eight } = await startedTogether(world);
  const before = (await world.rows()).map((row) => row.check_run_id);
  await world.settle(8, 'success', toStoredDetails(PASSING));
  await world.reporter.publish(eight, PASSING, NAMES);
  await world.settle(7, 'success', toStoredDetails(PASSING));
  await world.reporter.publish(seven, PASSING, NAMES);
  expect((await world.rows()).map((row) => row.check_run_id)).toEqual(before);
});

test('a verdict that is still in progress converges nothing: the pull request that is still running will', async () => {
  const world = await reportingWorld();
  const { eight } = await startedTogether(world);
  const writes = world.fake.checkRunWrites.length;
  await world.settle(8, 'success', toStoredDetails(PASSING));
  await world.reporter.publish(eight, PASSING, NAMES);
  expect(world.fake.checkRunWrites).toHaveLength(writes + 1);
  expect(methods(world.fake).filter((method) => method === 'listCheckRunsForRef')).toHaveLength(2);
});

test('when the run just written is the newest, nothing more is written', async () => {
  const world = await reportingWorld();
  const seven = await world.evaluation();
  const eight = await world.evaluation({ prNumber: 8 });
  listed(world, pullRef(7), pullRef(8));
  await world.reporter.started(seven);
  await world.reporter.started(eight);
  await world.settle(8, 'success', toStoredDetails(PASSING));
  await world.settle(7, 'success', toStoredDetails(PASSING));
  const writes = world.fake.checkRunWrites.length;
  await world.reporter.publish(seven, PASSING, NAMES);
  expect(world.fake.checkRunWrites).toHaveLength(writes + 1);
});
