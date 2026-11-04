// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import type { AffectedPrs } from './affected-prs.ts';
import { enqueueAffectedPrs } from './affected-prs.ts';
import { failingAfterSend, fakeEnqueuer, sentJobs } from './jobs-fixture/test-support.ts';
import type { JobEnqueuer } from './ports/jobs.ts';
import { coveredBy, revocationWorld, sentAs, storePr } from './revocation-fixture/test-support.ts';

// The jobs an action of a maintainer sends for the pull requests it affects (E15-S03): one `evaluate-pr` job each, keyed by the action,
// the repository and the pull request, up to 100; above that one `sweep-repository` job for each repository that has an affected pull
// request. Tenant 1's repositories are `org-1/repo` (GitHub id 9000) and `org-1/scoped` (9001).

const SIGNER = 4711;

/** A world with an open success covered by the signer in the plain repository (pull request 61) and one in the scoped (62). */
async function world() {
  const base = await revocationWorld();
  const { db, t1 } = base;
  const details = coveredBy({ githubId: SIGNER, signatureId: 31 });
  await storePr(db, t1, 'plain', { prNumber: 61, details });
  await storePr(db, t1, 'scoped', { prNumber: 62, details });
  const affected = (overrides: Partial<AffectedPrs> = {}): AffectedPrs => ({
    repositoryIds: [t1.plain.repositoryId, t1.scoped.repositoryId],
    result: 'success',
    detailsMatch: (stored) => sql<boolean>`${stored} @> ${JSON.stringify({ actors: [{ githubId: SIGNER }] })}::jsonb`,
    action: { reason: 'signature_revoked', change: '31' },
    trigger: 'signature',
    ...overrides,
  });
  const send = (using: JobEnqueuer = base.queue, overrides: Partial<AffectedPrs> = {}) =>
    db
      .transaction()
      .execute((trx) => enqueueAffectedPrs(trx, using, { installationId: t1.installationId }, affected(overrides)));
  /** Stores `count` more successes in the plain repository, numbered from 100. */
  const fill = async (count: number, which: 'plain' | 'scoped' = 'plain') => {
    for (let index = 0; index < count; index += 1) {
      await storePr(db, t1, which, { prNumber: 100 + index, details });
    }
  };
  return { ...base, affected, send, fill };
}

test('one evaluate-pr job is sent for each open pull request, with the trigger of the action, the key of the action, the repository and the number, and no limit that could drop it', async () => {
  const { db, t1, send } = await world();
  expect(await send()).toBe(2);
  expect(await sentJobs(db)).toEqual([
    {
      idempotencyKey: `signature_revoked:31:${t1.plain.githubRepoId}:61`,
      dedupeKey: null,
      job: {
        type: 'evaluate-pr',
        githubInstallationId: t1.githubInstallationId,
        githubRepoId: t1.plain.githubRepoId,
        prNumber: 61,
        trigger: 'signature',
      },
    },
    {
      idempotencyKey: `signature_revoked:31:${t1.scoped.githubRepoId}:62`,
      dedupeKey: null,
      job: {
        type: 'evaluate-pr',
        githubInstallationId: t1.githubInstallationId,
        githubRepoId: t1.scoped.githubRepoId,
        prNumber: 62,
        trigger: 'signature',
      },
    },
  ]);
});

test('the trigger is the one the action names', async () => {
  const { db, send } = await world();
  await send(undefined, { trigger: 'policy_change' });
  const triggers = (await sentJobs(db)).map(({ job }) => (job.type === 'evaluate-pr' ? job.trigger : job.type));
  expect(triggers).toEqual(['policy_change', 'policy_change']);
});

test('the same action sent again sends nothing twice: the keys name the action, and a later action sends again', async () => {
  const { db, send } = await world();
  await send();
  await send();
  expect(await sentAs(db)).toEqual(['9000#61', '9001#62']);
  await send(undefined, { action: { reason: 'signature_revoked', change: '32' } });
  expect(await sentAs(db)).toEqual(['9000#61', '9001#62', '9000#61', '9001#62']);
});

test('only the repositories the action names are looked at, and none names nothing to send', async () => {
  const { db, t1, send, queue } = await world();
  expect(await send(undefined, { repositoryIds: [t1.scoped.repositoryId] })).toBe(1);
  expect(await sentAs(db)).toEqual(['9001#62']);
  expect(await send(undefined, { repositoryIds: [] })).toBe(0);
  expect(queue.calls).toHaveLength(1);
});

test('exactly 100 pull requests are evaluated one by one', async () => {
  const { db, send, fill } = await world();
  await fill(98);
  expect(await send()).toBe(100);
  const sent = await sentAs(db);
  expect(sent).toHaveLength(100);
  expect(sent.some((entry) => entry.startsWith('sweep'))).toBe(false);
});

test('101 pull requests are swept: one sweep-repository job for each repository that has an affected pull request, and no evaluate-pr job', async () => {
  const { db, t1, send, fill } = await world();
  await fill(99);
  expect(await send()).toBe(2);
  expect(await sentJobs(db)).toEqual([
    {
      idempotencyKey: `sweep-repository:signature_revoked:31:${t1.plain.githubRepoId}`,
      dedupeKey: null,
      coalesceKey: `sweep-repository:${t1.plain.githubRepoId}`,
      job: {
        type: 'sweep-repository',
        githubInstallationId: t1.githubInstallationId,
        githubRepoId: t1.plain.githubRepoId,
        reason: 'signature_revoked',
      },
    },
    {
      idempotencyKey: `sweep-repository:signature_revoked:31:${t1.scoped.githubRepoId}`,
      dedupeKey: null,
      coalesceKey: `sweep-repository:${t1.scoped.githubRepoId}`,
      job: {
        type: 'sweep-repository',
        githubInstallationId: t1.githubInstallationId,
        githubRepoId: t1.scoped.githubRepoId,
        reason: 'signature_revoked',
      },
    },
  ]);
});

test('above 100 a repository with no affected pull request gets no sweep, though others do', async () => {
  const { db, t1, send, fill } = await world();
  await fill(101);
  await db
    .updateTable('pr_evaluations')
    .set({ pr_state: 'closed' })
    .where('repository_id', '=', t1.scoped.repositoryId)
    .execute();
  expect(await send()).toBe(1);
  expect(await sentAs(db)).toEqual(['sweep 9000']);
});

test('a sweep that finds a run waiting for the repository counts as sent, because that run covers the change', async () => {
  const { db, send, fill } = await world();
  await fill(100);
  expect(await send()).toBe(2);
  expect(await send(undefined, { action: { reason: 'signature_revoked', change: '32' } })).toBe(2);
  expect(await sentAs(db)).toEqual(['sweep 9000', 'sweep 9001']);
});

test('a send that fails fails the call, and the jobs of the same transaction are not kept', async () => {
  const { db, send } = await world();
  await expect(send(failingAfterSend(fakeEnqueuer(), new Error('queue is down')))).rejects.toThrow('queue is down');
  expect(await sentAs(db)).toEqual([]);
  const rows = await sql<{ n: number }>`select count(*)::int as n from fake_jobs`.execute(db);
  expect(rows.rows).toEqual([{ n: 0 }]);
});
