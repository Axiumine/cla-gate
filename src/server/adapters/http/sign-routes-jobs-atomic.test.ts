// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { fakeEnqueuer, jobCount, sentJobs } from '../../services/jobs-fixture/test-support.ts';
import { notWiredEnqueuer } from '../../services/jobs-not-wired.ts';
import { errorCodeOf } from './sign-context-fixture/test-support.ts';
import {
  failingForAda,
  NOTHING_WRITTEN,
  postSign,
  refusingSend,
  signedOf,
  signingWorld,
  writtenRows,
} from './sign-fixture/test-support.ts';

// The jobs and the signature are one transaction (E13-S07): a send the queue refuses takes the signature back, with its personal
// data, its audit row and every job already sent for it; the client gets a 500 that says nothing of the queue, and a retry succeeds.

test.each([
  ['the first send (the pull request the person came from)', 1],
  ['a later send (a failing pull request found for the person)', 2],
] as const)(
  'when the queue refuses %s the answer is a 500, nothing is left behind, and a retry succeeds',
  async (_name, nth) => {
    const queue = refusingSend(fakeEnqueuer(), nth);
    const { world, ada, body } = await signingWorld({}, queue);
    await failingForAda(world, 1, 61, 1);
    const failed = await postSign(world, ada, body({ name: 'zzzz-typed-name' }));
    expect([failed.statusCode, errorCodeOf(failed)]).toEqual([500, 'internal_server_error']);
    expect(failed.body).not.toContain('zzzz');
    expect(await writtenRows(world.db)).toEqual(NOTHING_WRITTEN);
    expect(await jobCount(world.db)).toBe(0);

    const retried = signedOf(await postSign(world, ada, body()), 201);
    expect(retried.created).toBe(true);
    expect(await writtenRows(world.db)).toEqual({ signatures: 1, signerPii: 1, audit: 1 });
    expect((await sentJobs(world.db)).map((sent) => sent.idempotencyKey)).toEqual([
      `signature:${retried.signature.id}:9000:45`,
      `signature:${retried.signature.id}:9000:61`,
    ]);
  },
);

test('a failed attempt does not make the retry a repeat: the unique index holds no row of the rolled-back transaction', async () => {
  const { world, ada, body } = await signingWorld({}, refusingSend(fakeEnqueuer(), 1));
  expect((await postSign(world, ada, body())).statusCode).toBe(500);
  const second = await postSign(world, ada, body());
  const third = await postSign(world, ada, body());
  expect([second.statusCode, third.statusCode]).toEqual([201, 200]);
  expect(await jobCount(world.db)).toBe(1);
});

test('an application built without a queue fails every new signature with a 500 that names no queue, and records nothing', async () => {
  const { world, ada, body } = await signingWorld({}, notWiredEnqueuer);
  const failed = await postSign(world, ada, body());
  expect([failed.statusCode, errorCodeOf(failed)]).toEqual([500, 'internal_server_error']);
  expect(failed.body).not.toContain('wired');
  expect(await writtenRows(world.db)).toEqual(NOTHING_WRITTEN);
});
