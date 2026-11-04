// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { ClaRuleError } from './cla-rule-error.ts';
import { failingAfterSend, fakeEnqueuer, sentJobs } from './jobs-fixture/test-support.ts';
import { coveredBy, revocationBy, revocationWorld, sentAs, storePr } from './revocation-fixture/test-support.ts';
import { revokeSignature } from './signature-revoke.ts';

// The service of a revocation (E15-S03), on the two tenants of the revocation world: what one call writes, what it refuses and that
// it commits with its audit row and its jobs or not at all. Tenant 1's signer is `people.member1`; their signature is `t1.signatureId`.

/** The world with a pull request of tenant 1 that relied on the signature. */
async function world() {
  const base = await revocationWorld();
  const { db, t1, people } = base;
  const details = coveredBy({ githubId: people.member1.githubId, signatureId: t1.signatureId });
  await storePr(db, t1, 'plain', { prNumber: 61, details });
  const scope = { installationId: t1.installationId };
  const signatureOf = (id: number) =>
    db.selectFrom('signatures').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const audits = () => db.selectFrom('audit_log').selectAll().where('action', '=', 'signature.revoked').execute();
  return { ...base, scope, signatureOf, audits };
}

test('a revocation sets the three columns, appends the audit row and sends the job of the pull request that relied on the signature, and answers with what it did', async () => {
  const { db, t1, people, queue, scope, signatureOf, audits } = await world();
  const revoked = await revokeSignature({ db, enqueuer: queue }, scope, revocationBy(t1, t1.signatureId));
  const row = await signatureOf(t1.signatureId);
  expect(revoked).toEqual({ id: t1.signatureId, revokedAt: row.revoked_at, reevaluating: 1 });
  expect(row).toMatchObject({ revoked_by: people.admin1.userId, revoke_reason: 'maintainer_decision' });
  expect((await audits()).map((audit) => audit.subject_id)).toEqual([t1.signatureId]);
  expect(await sentAs(db)).toEqual([`${t1.plain.githubRepoId}#61`]);
});

test('the time of the revocation is the database clock, not the clock of the process', async () => {
  const { db, t1, queue, scope } = await world();
  const before = Date.now();
  const revoked = await revokeSignature({ db, enqueuer: queue }, scope, revocationBy(t1, t1.signatureId));
  expect(Math.abs(revoked.revokedAt.getTime() - before)).toBeLessThan(60_000);
  expect(revoked.revokedAt).toBeInstanceOf(Date);
});

test("a signature that is not the tenant's is not found, though it exists: the tenant of the scope is the only one looked in, and nothing is written", async () => {
  const { db, t1, t2, queue, scope, signatureOf, audits } = await world();
  for (const id of [t2.signatureId, 987_654]) {
    await expect(revokeSignature({ db, enqueuer: queue }, scope, revocationBy(t1, id))).rejects.toEqual(
      new ClaRuleError('not_found'),
    );
  }
  expect((await signatureOf(t2.signatureId)).revoked_at).toBeNull();
  expect(await audits()).toEqual([]);
  expect(await sentJobs(db)).toEqual([]);
});

test('a signature that is revoked already is refused with already_revoked, and the first revocation, its audit row and its jobs are all there is', async () => {
  const { db, t1, queue, scope, signatureOf, audits } = await world();
  await revokeSignature({ db, enqueuer: queue }, scope, {
    ...revocationBy(t1, t1.signatureId),
    reason: 'signer_request',
  });
  const first = await signatureOf(t1.signatureId);
  await expect(
    revokeSignature({ db, enqueuer: queue }, scope, { ...revocationBy(t1, t1.signatureId), reason: 'legal_request' }),
  ).rejects.toEqual(new ClaRuleError('already_revoked'));
  expect(await signatureOf(t1.signatureId)).toEqual(first);
  expect(await audits()).toHaveLength(1);
  expect(await sentJobs(db)).toHaveLength(1);
});

test("a queue that fails rolls everything back: the signature is in force, there is no audit row and no job, and the error is the queue's", async () => {
  const { db, t1, scope, signatureOf, audits } = await world();
  const down = new Error('zzzz the queue is down');
  await expect(
    revokeSignature({ db, enqueuer: failingAfterSend(fakeEnqueuer(), down) }, scope, revocationBy(t1, t1.signatureId)),
  ).rejects.toBe(down);
  expect((await signatureOf(t1.signatureId)).revoked_at).toBeNull();
  expect(await audits()).toEqual([]);
  expect(await sentJobs(db)).toEqual([]);
});

test('a signature that nobody relied on is revoked without a job', async () => {
  const { db, t2, queue } = await world();
  const revoked = await revokeSignature(
    { db, enqueuer: queue },
    { installationId: t2.installationId },
    revocationBy(t2, t2.signatureId),
  );
  expect(revoked.reevaluating).toBe(0);
  expect(await sentJobs(db)).toEqual([]);
});
