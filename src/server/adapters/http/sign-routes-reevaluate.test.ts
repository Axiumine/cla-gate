// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { postSign, signedOf, withoutPrNumber } from './sign-fixture/test-support.ts';
import { evaluateJob, reevaluationWorld } from './sign-reevaluate-fixture/test-support.ts';

// From the signature to the green check (E13-S07), end to end on one database and a mocked GitHub (MSW): a pull request is evaluated
// and fails, its author signs, the job the signing sent runs, and the Check Run the first evaluation left red is updated to success.
// The send is on the transaction of the signature, so the job cannot be read by a worker before the signature is committed.

test('a pull request that failed is evaluated again after its author signs, and its failing license/cla Check Run turns to success', async () => {
  const { world, ada, body, open, run, queued, checkRunWrites } = await reevaluationWorld();
  open(7, 2);
  expect(await run(evaluateJob(7))).toEqual({ outcome: 'evaluated' });
  expect(checkRunWrites()).toEqual(['create 9000001 in_progress none', 'update 9000001 completed failure']);
  expect(await world.db.selectFrom('pr_evaluations').select('result').where('pr_number', '=', 7).execute()).toEqual([
    { result: 'failure' },
  ]);

  signedOf(await postSign(world, ada, body({ prNumber: 7 })), 201);
  const jobs = await queued();
  expect(jobs).toEqual([evaluateJob(7, 'signature')]);

  expect(await run(jobs[0] ?? evaluateJob(0))).toEqual({ outcome: 'evaluated' });
  expect(checkRunWrites().slice(2)).toEqual(['update 9000001 completed success']);
  expect(await world.db.selectFrom('pr_evaluations').select('result').where('pr_number', '=', 7).execute()).toEqual([
    { result: 'success' },
  ]);
});

test("the person's other failing pull request turns green from the same signing", async () => {
  const { world, ada, body, open, run, queued, checkRunWrites } = await reevaluationWorld();
  open(7, 2);
  open(8, 4);
  for (const prNumber of [7, 8]) {
    await run(evaluateJob(prNumber));
  }
  expect(checkRunWrites()).toHaveLength(4);

  signedOf(await postSign(world, ada, body({ prNumber: 7 })), 201);
  const jobs = await queued();
  expect(jobs.map((job) => [job.prNumber, job.trigger])).toEqual([
    [7, 'signature'],
    [8, 'signature'],
  ]);
  for (const job of jobs) {
    await run(job);
  }
  expect(checkRunWrites().slice(4)).toEqual(['update 9000001 completed success', 'update 9000002 completed success']);
});

test('a signing from the dashboard (no pull request named) turns the failing pull request green all the same', async () => {
  const { world, ada, body, open, run, queued, checkRunWrites } = await reevaluationWorld();
  open(7, 2);
  await run(evaluateJob(7));
  signedOf(await postSign(world, ada, withoutPrNumber(body())), 201);
  const jobs = await queued();
  expect(jobs).toEqual([evaluateJob(7, 'signature')]);
  await run(jobs[0] ?? evaluateJob(0));
  expect(checkRunWrites().slice(2)).toEqual(['update 9000001 completed success']);
});

test('a pull request that was closed before the job ran is left alone: the job sees the state and writes nothing', async () => {
  const { world, ada, body, open, run, queued, checkRunWrites } = await reevaluationWorld();
  open(7, 2);
  await run(evaluateJob(7));
  signedOf(await postSign(world, ada, body({ prNumber: 7 })), 201);
  open(7, 2, 'closed');
  const jobs = await queued();
  expect(await run(jobs[0] ?? evaluateJob(0))).toEqual({ outcome: 'skipped:pull_request_closed' });
  expect(checkRunWrites()).toEqual(['create 9000001 in_progress none', 'update 9000001 completed failure']);
});
