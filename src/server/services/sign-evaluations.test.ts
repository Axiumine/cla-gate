// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { twoTenants } from '../adapters/db/tenant-fixture/test-support.ts';
import { migratedTestDatabase } from '../adapters/db/test-support.ts';
import { failureDetails } from '../domain/failure-details-fixture/test-support.ts';
import { RECHECK_WINDOW_SECONDS, recheckRateLimitKey } from '../domain/recheck.ts';
import { evaluationCoalesceKey } from '../domain/sweep.ts';
import { createJobsTable, fakeEnqueuer, sentJobs } from './jobs-fixture/test-support.ts';
import type { JobEnqueuer } from './ports/jobs.ts';
import { enqueueSignatureEvaluations, type RecordedSignature } from './sign-evaluations.ts';
import { attachDocument, storeFailure } from './sign-evaluations-fixture/test-support.ts';

// The jobs a new signature sends (E13-S07), called inside a transaction as the sign request does: the pull request the person came
// from first, then their other failing pull requests of the tenant, newest first, at most 25, each sent once, with the trigger
// `signature` and a key that names the signature. Tenant 1's repositories are `org-1/repo` (GitHub id 9000) and `org-1/scoped` (9001).

const SIGNATURE_ID = 5;

/** The world: two tenants, a fake queue on the same database, and a way to send as the signer of tenant 1. */
async function world() {
  const { db } = await migratedTestDatabase();
  const tenants = await twoTenants(db);
  await createJobsTable(db);
  const { t1, t2 } = tenants;
  await attachDocument(db, t1, ['plain', 'scoped']);
  await attachDocument(db, t2, ['plain', 'scoped']);
  const queue = fakeEnqueuer();
  const ada = t1.signer.githubId;
  const signed = (prNumber: number | null, overrides: Partial<RecordedSignature> = {}): RecordedSignature => ({
    scope: { installationId: t1.installationId },
    githubInstallationId: t1.githubInstallationId,
    signatureId: SIGNATURE_ID,
    documentId: t1.documentId,
    signer: ada,
    source: { repositoryId: t1.plain.repositoryId, githubRepoId: t1.plain.githubRepoId, prNumber },
    ...overrides,
  });
  const send = (signature: RecordedSignature, using: JobEnqueuer = queue) =>
    db.transaction().execute((trx) => enqueueSignatureEvaluations(trx, using, signature));
  const fail = (repository: 'plain' | 'scoped', prNumber: number, day: number, uncovered: readonly number[] = [ada]) =>
    storeFailure(
      db,
      { installationId: t1.installationId, repositoryId: (repository === 'plain' ? t1.plain : t1.scoped).repositoryId },
      { prNumber, details: failureDetails({ uncovered }), updatedAt: new Date(Date.UTC(2026, 5, day)) },
    );
  /** What was sent, as `<repository>#<pull request>` in the order sent. */
  const sent = async () =>
    (await sentJobs(db)).map(({ job }) =>
      job.type === 'evaluate-pr' ? `${job.githubRepoId}#${job.prNumber}` : job.type,
    );
  return { db, ...tenants, ada, queue, signed, send, fail, sent };
}

test('the pull request the person came from gets an evaluate-pr job with the trigger signature, keyed by the signature, with no limit that could drop it', async () => {
  const { db, t1, signed, send } = await world();
  await send(signed(45));
  expect(await sentJobs(db)).toEqual([
    {
      idempotencyKey: `signature:${SIGNATURE_ID}:${t1.plain.githubRepoId}:45`,
      dedupeKey: null,
      job: {
        type: 'evaluate-pr',
        githubInstallationId: t1.githubInstallationId,
        githubRepoId: t1.plain.githubRepoId,
        prNumber: 45,
        trigger: 'signature',
      },
    },
  ]);
});

test('the other failing pull requests follow the origin, newest first, from every repository attached to the document', async () => {
  const { t1, signed, send, fail, sent } = await world();
  await fail('plain', 61, 1);
  await fail('scoped', 62, 3);
  await fail('plain', 63, 2);
  await send(signed(45));
  const [plain, scoped] = [t1.plain.githubRepoId, t1.scoped.githubRepoId];
  expect(await sent()).toEqual([`${plain}#45`, `${scoped}#62`, `${plain}#63`, `${plain}#61`]);
});

test('a pull request that fails for the person and is the origin is sent once, and a failure that does not list the person is not sent', async () => {
  const { t1, ada, signed, send, fail, sent } = await world();
  await fail('plain', 45, 4);
  await fail('plain', 61, 3);
  await fail('plain', 62, 2, [ada + 1]);
  await send(signed(45));
  expect(await sent()).toEqual([`${t1.plain.githubRepoId}#45`, `${t1.plain.githubRepoId}#61`]);
});

test('a signing from the dashboard names no pull request: no origin job is sent, and the failing pull requests are still found', async () => {
  const { t1, signed, send, fail, sent } = await world();
  await fail('plain', 45, 4);
  await fail('scoped', 61, 3);
  await send(signed(null));
  expect(await sent()).toEqual([`${t1.plain.githubRepoId}#45`, `${t1.scoped.githubRepoId}#61`]);
});

test('with no pull request named and nothing failing no job is sent at all', async () => {
  const { queue, signed, send, sent } = await world();
  await send(signed(null));
  expect(await sent()).toEqual([]);
  expect(queue.calls).toEqual([]);
});

test('at most 25 other pull requests are sent, the newest ones; the rest are left to the reconciliation sweep', async () => {
  const { t1, signed, send, fail, sent } = await world();
  for (let prNumber = 100; prNumber < 130; prNumber += 1) {
    await fail('plain', prNumber, prNumber - 99);
  }
  await send(signed(45));
  const jobs = await sent();
  expect(jobs).toHaveLength(26);
  expect(jobs.slice(1)).toEqual(Array.from({ length: 25 }, (_, index) => `${t1.plain.githubRepoId}#${129 - index}`));
});

test('failures that the schema of E08 refuses are skipped and do not use up the cap', async () => {
  const { db, t1, ada, signed, send, fail, sent } = await world();
  const repository = { installationId: t1.installationId, repositoryId: t1.plain.repositoryId };
  for (let prNumber = 200; prNumber < 203; prNumber += 1) {
    const stale = { ...failureDetails({ uncovered: [ada] }), version: 2 };
    await storeFailure(db, repository, {
      prNumber,
      details: stale,
      updatedAt: new Date(Date.UTC(2026, 6, prNumber - 199)),
    });
  }
  for (let prNumber = 100; prNumber < 127; prNumber += 1) {
    await fail('plain', prNumber, prNumber - 99);
  }
  await send(signed(45));
  const jobs = await sent();
  expect(jobs).toHaveLength(26);
  expect(jobs.filter((job) => /#20\d$/.test(job))).toEqual([]);
  expect(jobs.at(1)).toBe(`${t1.plain.githubRepoId}#126`);
});

test('a second signature sends again under a key of its own, and a retry of the same signature sends nothing twice', async () => {
  const { db, t1, signed, send, fail, sent } = await world();
  await fail('plain', 61, 1);
  await send(signed(45));
  await send(signed(45));
  expect((await sentJobs(db)).map((job) => job.idempotencyKey)).toEqual([
    `signature:${SIGNATURE_ID}:${t1.plain.githubRepoId}:45`,
    `signature:${SIGNATURE_ID}:${t1.plain.githubRepoId}:61`,
  ]);
  await send(signed(45, { signatureId: SIGNATURE_ID + 1 }));
  expect(await sent()).toHaveLength(4);
});

test('an evaluation of the same pull request that already waits, or a /recheck of it in the same minute, does not stop the send: none is dropped', async () => {
  const { db, t1, queue, signed, send } = await world();
  const job = {
    type: 'evaluate-pr',
    githubInstallationId: t1.githubInstallationId,
    githubRepoId: t1.plain.githubRepoId,
    prNumber: 45,
  } as const;
  await db.transaction().execute(async (trx) => {
    await queue.enqueue(
      trx,
      { ...job, trigger: 'pull_request' },
      {
        idempotencyKey: 'pull_request:waiting',
        coalesceKey: evaluationCoalesceKey(job.githubRepoId, job.prNumber),
      },
    );
    await queue.enqueue(
      trx,
      { ...job, trigger: 'recheck' },
      {
        idempotencyKey: 'recheck:comment',
        dedupeKey: recheckRateLimitKey(job.githubRepoId, job.prNumber),
        dedupeWindowSeconds: RECHECK_WINDOW_SECONDS,
      },
    );
  });
  await send(signed(45));
  expect(
    (await sentJobs(db)).map((sent) => [sent.idempotencyKey, sent.job.type === 'evaluate-pr' && sent.job.trigger]),
  ).toEqual([
    ['pull_request:waiting', 'pull_request'],
    ['recheck:comment', 'recheck'],
    [`signature:${SIGNATURE_ID}:${t1.plain.githubRepoId}:45`, 'signature'],
  ]);
});

test('every job names the installation of the signature, not the one of another tenant that lists the same person', async () => {
  const { db, t1, t2, ada, signed, send, fail } = await world();
  await fail('plain', 61, 1);
  const foreign = { installationId: t2.installationId, repositoryId: t2.plain.repositoryId };
  await storeFailure(db, foreign, {
    prNumber: 70,
    details: failureDetails({ uncovered: [ada] }),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
  });
  await send(signed(45));
  const jobs = await sentJobs(db);
  expect(jobs.map(({ job }) => job)).toHaveLength(2);
  expect(new Set(jobs.map(({ job }) => (job.type === 'evaluate-pr' ? job.githubInstallationId : 0)))).toEqual(
    new Set([parseGithubId(t1.githubInstallationId)]),
  );
});

test('a send the queue refuses fails the call, and the sends made before it are rolled back with the transaction', async () => {
  const { db, signed, send, fail, queue } = await world();
  await fail('plain', 61, 1);
  let calls = 0;
  const failsSecond: JobEnqueuer = {
    enqueue: (trx, job, options) => {
      calls += 1;
      return calls === 2 ? Promise.reject(new Error('the queue went away')) : queue.enqueue(trx, job, options);
    },
  };
  await expect(send(signed(45), failsSecond)).rejects.toThrow('the queue went away');
  expect(calls).toBe(2);
  expect(await sentJobs(db)).toEqual([]);
});
