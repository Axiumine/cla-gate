// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { fakeEnqueuer, jobCount, sentJobs } from '../../services/jobs-fixture/test-support.ts';
import {
  bodyFor,
  failingForAda,
  postSign,
  revokeSignature,
  signedOf,
  signingWorld,
  withoutPrNumber,
  writtenRows,
} from './sign-fixture/test-support.ts';

// The pull requests a signature turns green (E13-S07), over HTTP: a new signature sends an evaluate-pr job for the pull request
// the person signed from and for their other failing pull requests of the tenant; a repeat sends nothing; and only the tenant that
// holds the repository is touched. The atomicity of the send is in sign-routes-jobs-atomic.test.ts, the whole path through the
// evaluation job and the Check Run in sign-routes-reevaluate.test.ts.

type World = Awaited<ReturnType<typeof signingWorld>>['world'];

/** What the queue holds, as `<repository>#<pull request>`, in the order sent. */
async function sentTargets(world: World) {
  return (await sentJobs(world.db)).map(({ job }) =>
    job.type === 'evaluate-pr' ? `${job.githubRepoId}#${job.prNumber}` : '?',
  );
}

test('a new signature sends the evaluate-pr job of the pull request it came from, keyed by the signature, after the signature is committed', async () => {
  const { world, ada, body } = await signingWorld();
  const answer = signedOf(await postSign(world, ada, body()), 201);
  expect(await sentJobs(world.db)).toEqual([
    {
      idempotencyKey: `signature:${answer.signature.id}:9000:45`,
      dedupeKey: null,
      job: {
        type: 'evaluate-pr',
        githubInstallationId: 5000,
        githubRepoId: 9000,
        prNumber: 45,
        trigger: 'signature',
      },
    },
  ]);
  expect(await writtenRows(world.db)).toEqual({ signatures: 1, signerPii: 1, audit: 1 });
});

test('the job is sent on the transaction that holds the new signature, which it can already read', async () => {
  const queue = fakeEnqueuer();
  const seen: { isTransaction: boolean; signatures: number }[] = [];
  const watching = {
    async enqueue(...args: Parameters<typeof queue.enqueue>) {
      const [tx] = args;
      const rows = await tx.selectFrom('signatures').select('id').execute();
      seen.push({ isTransaction: tx.isTransaction, signatures: rows.length });
      return queue.enqueue(...args);
    },
  };
  const { world, ada, body } = await signingWorld({}, watching);
  signedOf(await postSign(world, ada, body()), 201);
  expect(seen).toEqual([{ isTransaction: true, signatures: 1 }]);
});

test("the signer's other failing pull requests of the tenant are sent too, newest first, and the originating pull request once", async () => {
  const { world, ada, body } = await signingWorld();
  await failingForAda(world, 1, 45, 5);
  await failingForAda(world, 1, 61, 1);
  await failingForAda(world, 1, 62, 3);
  signedOf(await postSign(world, ada, body()), 201);
  expect(await sentTargets(world)).toEqual(['9000#45', '9000#62', '9000#61']);
});

test('a signature without prNumber (from the dashboard) sends no originating job and still sends the failing pull requests', async () => {
  const { world, ada } = await signingWorld();
  await failingForAda(world, 1, 61, 1);
  signedOf(await postSign(world, ada, withoutPrNumber(bodyFor(world.t1, 1))), 201);
  expect(await sentTargets(world)).toEqual(['9000#61']);
});

test('a signature from the dashboard with no failing pull request sends no job at all', async () => {
  const { world, ada } = await signingWorld();
  signedOf(await postSign(world, ada, withoutPrNumber(bodyFor(world.t1, 1))), 201);
  expect(await jobCount(world.db)).toBe(0);
});

test("a failing pull request of tenant 2 that lists the same numeric id is not sent when the person signs for tenant 1, and tenant 1's is not sent when they sign for tenant 2", async () => {
  const { world, ada, body } = await signingWorld();
  await failingForAda(world, 1, 61, 1);
  await failingForAda(world, 2, 70, 9);
  signedOf(await postSign(world, ada, body()), 201);
  expect(await sentTargets(world)).toEqual(['9000#45', '9000#61']);
  signedOf(await postSign(world, ada, bodyFor(world.t2, 2, { prNumber: 3 })), 201);
  const jobs = await sentJobs(world.db);
  expect(
    jobs
      .slice(2)
      .map(({ job }) => (job.type === 'evaluate-pr' ? [job.githubInstallationId, job.githubRepoId, job.prNumber] : [])),
  ).toEqual([
    [10_000, 18_000, 3],
    [10_000, 18_000, 70],
  ]);
});

test('a repeat (200, created false) sends nothing, however many pull requests fail for the person', async () => {
  const queue = fakeEnqueuer();
  const { world, ada, body } = await signingWorld({}, queue);
  await failingForAda(world, 1, 61, 1);
  signedOf(await postSign(world, ada, body()), 201);
  const before = { calls: queue.calls.length, jobs: await jobCount(world.db) };
  expect(before).toEqual({ calls: 2, jobs: 2 });
  signedOf(await postSign(world, ada, body()), 200);
  signedOf(await postSign(world, ada, body({ prNumber: 99 })), 200);
  expect({ calls: queue.calls.length, jobs: await jobCount(world.db) }).toEqual(before);
});

test('a person whose signature was revoked signs again and the new signature sends its own jobs, under its own key', async () => {
  const { world, ada, body } = await signingWorld();
  const first = signedOf(await postSign(world, ada, body()), 201);
  await revokeSignature(world, first.signature.id);
  const second = signedOf(await postSign(world, ada, body()), 201);
  const keys = (await sentJobs(world.db)).map((sent) => sent.idempotencyKey);
  expect(keys).toEqual([`signature:${first.signature.id}:9000:45`, `signature:${second.signature.id}:9000:45`]);
});

test('a request that fails a check sends nothing: the version is stale, so no signature is written and no job is sent', async () => {
  const { world, ada, body } = await signingWorld();
  await failingForAda(world, 1, 61, 1);
  const refused = await postSign(world, ada, body({ contentSha256: 'f'.repeat(64) }));
  expect(refused.statusCode).toBe(422);
  expect(await jobCount(world.db)).toBe(0);
});
