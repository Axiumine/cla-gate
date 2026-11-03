// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { FAILING, NAMES, PASSING, reportingWorld } from './test-support.ts';

// Several open pull requests can share one head SHA, and the Check Run belongs to the SHA (E09-S05). The run says the worst
// `result` among the rows (`failure` over `in_progress` over `success`); each pull request keeps its own row, and the reporter
// takes no lock, because the queue serialises one pull request and two pull requests are allowed to race.

const methods = (fake: { calls: readonly { method: string }[] }): string[] => fake.calls.map((call) => call.method);

test.each([
  ['failure', 'completed', 'failure', 'CLA check failed'],
  ['in_progress', 'in_progress', undefined, 'Checking CLA signatures'],
  ['success', 'completed', 'success', 'CLA check passed'],
  ['cancelled', 'completed', 'success', 'CLA check passed'],
] as const)(
  'pull request 7 passes while the row of pull request 8 at the same SHA is %s: the run is %s with the conclusion %s',
  async (other, status, conclusion, title) => {
    const world = await reportingWorld();
    const target = await world.evaluation({ result: 'success' });
    await world.evaluation({ prNumber: 8, result: other });
    await world.reporter.started(target);
    await world.reporter.publish(target, PASSING, NAMES);
    expect(world.fake.checkRuns).toHaveLength(1);
    expect(world.fake.checkRuns[0]?.run.status).toBe(status);
    expect(world.fake.checkRuns[0]?.write?.conclusion).toBe(conclusion);
    expect(world.fake.checkRuns[0]?.write?.title).toBe(title);
    expect(world.fake.checkRuns[0]?.write).not.toHaveProperty('detailsUrl');
  },
);

test('a failing pull request shows its own failure on the run even when the other one passes', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation({ result: 'failure' });
  await world.evaluation({ prNumber: 8, result: 'success' });
  await world.reporter.publish(target, FAILING, NAMES);
  expect(world.fake.checkRuns[0]?.write).toMatchObject({
    conclusion: 'failure',
    title: 'CLA signature required: 1 unsigned',
    detailsUrl: 'https://cla.example.org/sign/9000?pr=7',
  });
});

test('two pull requests on one SHA, one after the other, share the one run and each row records it', async () => {
  const world = await reportingWorld();
  const first = await world.evaluation({ result: 'success' });
  await world.reporter.started(first);
  await world.reporter.publish(first, PASSING, NAMES);
  const second = await world.evaluation({ prNumber: 8, result: 'failure' });
  await world.reporter.started(second);
  await world.reporter.publish(second, FAILING, NAMES);
  expect(world.fake.checkRuns).toHaveLength(1);
  expect(world.fake.checkRuns[0]?.write).toMatchObject({
    conclusion: 'failure',
    externalId: String(second.evaluationId),
  });
  const id = world.fake.checkRuns[0]?.run.id;
  expect((await world.rows()).map((row) => [row.pr_number, row.check_run_id])).toEqual([
    [7, id],
    [8, id],
  ]);
});

test('two pull requests on one SHA at the same moment each create a run, each row records its own, and both runs carry the worst conclusion', async () => {
  const world = await reportingWorld();
  const first = await world.evaluation();
  const second = await world.evaluation({ prNumber: 8 });
  const arrived = Promise.withResolvers<undefined>();
  let listings = 0;
  const meet = (): Promise<undefined> => {
    listings += 1;
    if (listings === 2) {
      arrived.resolve(undefined);
    }
    return arrived.promise;
  };
  world.fake.beforeNext('listCheckRunsForRef', meet);
  world.fake.beforeNext('listCheckRunsForRef', meet);
  await Promise.all([world.reporter.started(first), world.reporter.started(second)]);
  expect(world.fake.checkRuns).toHaveLength(2);
  const [row7, row8] = await world.rows();
  expect(new Set([row7?.check_run_id, row8?.check_run_id]).size).toBe(2);
  await sql`update pr_evaluations set result = 'success' where pr_number = 7`.execute(world.db);
  await sql`update pr_evaluations set result = 'failure' where pr_number = 8`.execute(world.db);
  await Promise.all([world.reporter.publish(first, PASSING, NAMES), world.reporter.publish(second, FAILING, NAMES)]);
  expect(world.fake.checkRuns.map((stored) => stored.write?.conclusion)).toEqual(['failure', 'failure']);
  expect(world.fake.checkRuns.map((stored) => stored.run.status)).toEqual(['completed', 'completed']);
  expect(methods(world.fake).filter((method) => method === 'createCheckRun')).toHaveLength(2);
});
