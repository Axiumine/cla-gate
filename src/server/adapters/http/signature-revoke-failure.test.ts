// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { failureDetails } from '../../domain/failure-details-fixture/test-support.ts';
import { fakeEnqueuer, sentJobs, switchableEnqueuer } from '../../services/jobs-fixture/test-support.ts';
import type { JobEnqueuer } from '../../services/ports/jobs.ts';
import { coveredBy, sentAs, storePr } from '../../services/revocation-fixture/test-support.ts';
import { realPostgresOnly } from '../db/test-support.ts';
import { errorCodeOf, tablesOf } from './document-fixture/test-support.ts';
import { refusingSend } from './sign-fixture/test-support.ts';
import {
  enforceDocuments,
  revokeAs,
  revokedAuditRows,
  revokeWith,
  revokeWorld,
  signatureRow,
} from './signature-revoke-fixture/test-support.ts';

// What a revocation does when the queue fails and when two revocations arrive at once (E15-S03): it commits with its jobs or not at
// all, and exactly one of two simultaneous calls revokes.

/** Tenant 1 with three open pull requests that relied on the signature (and one that did not), the queue of the app being `enqueuer`. */
async function reliedUpon(enqueuer: JobEnqueuer = fakeEnqueuer()) {
  const world = await revokeWorld(enqueuer);
  await enforceDocuments(world);
  const { db, t1, people } = world;
  const relied = coveredBy({ githubId: people.member1.githubId, signatureId: t1.signatureId });
  for (const prNumber of [61, 62, 63]) {
    await storePr(db, t1, 'plain', { prNumber, details: relied });
  }
  await storePr(db, t1, 'plain', { prNumber: 64, result: 'failure', details: failureDetails({ uncovered: [4711] }) });
  return world;
}

test('a queue that fails after the first send rolls the revocation back: 500, the signature is still in force, no audit row, no job, and no table has changed', async () => {
  const world = await reliedUpon(refusingSend(fakeEnqueuer(), 1));
  const { t1 } = world;
  const before = await tablesOf(world);
  const response = await revokeAs(world, 'admin1', t1.installationId, t1.signatureId);
  expect([response.statusCode, errorCodeOf(response)]).toEqual([500, 'internal_server_error']);
  expect(response.body).not.toContain('zzzz');
  const row = await signatureRow(world, t1.signatureId);
  expect([row.revoked_at, row.revoked_by, row.revoke_reason]).toEqual([null, null, null]);
  expect(await revokedAuditRows(world)).toEqual([]);
  expect(await sentJobs(world.db)).toEqual([]);
  expect(await tablesOf(world)).toEqual(before);
});

test('a queue that fails on the last of several sends rolls back the sends before it as well', async () => {
  const world = await reliedUpon(refusingSend(fakeEnqueuer(), 3));
  const { t1 } = world;
  const response = await revokeAs(world, 'admin1', t1.installationId, t1.signatureId);
  expect(response.statusCode).toBe(500);
  expect((await signatureRow(world, t1.signatureId)).revoked_at).toBeNull();
  expect(await sentAs(world.db)).toEqual([]);
});

test('the same request when the queue is back revokes: 200, the three jobs, one audit row', async () => {
  const queue = switchableEnqueuer(fakeEnqueuer());
  const world = await reliedUpon(queue);
  const { t1 } = world;
  queue.failWith(new Error('zzzz the queue is down'));
  const down = await revokeAs(world, 'admin1', t1.installationId, t1.signatureId);
  queue.failWith(undefined);
  const back = await revokeAs(world, 'admin1', t1.installationId, t1.signatureId);
  expect([down.statusCode, back.statusCode]).toEqual([500, 200]);
  expect(await sentAs(world.db)).toHaveLength(3);
  expect(await revokedAuditRows(world)).toHaveLength(1);
});

test('two revocations one after the other give a 200 and a 409, one audit row and one set of jobs, on whatever engine runs the suite', async () => {
  const world = await reliedUpon();
  const { t1 } = world;
  const first = await revokeAs(world, 'admin1', t1.installationId, t1.signatureId);
  const second = await revokeAs(world, 'admin1', t1.installationId, t1.signatureId);
  expect([first.statusCode, second.statusCode]).toEqual([200, 409]);
  expect(await revokedAuditRows(world)).toHaveLength(1);
  expect(await sentJobs(world.db)).toHaveLength(3);
});

realPostgresOnly(
  'two simultaneous revocations give one 200 and one 409, and exactly one audit row, every round',
  async () => {
    const world = await reliedUpon();
    const { t1 } = world;
    const answers = await Promise.all([
      revokeWith(
        world,
        'admin1',
        { installationId: t1.installationId, signatureId: t1.signatureId },
        { reasonCode: 'signer_request' },
      ),
      revokeWith(
        world,
        'admin1',
        { installationId: t1.installationId, signatureId: t1.signatureId },
        { reasonCode: 'legal_request' },
      ),
    ]);
    expect(answers.map((answer) => answer.statusCode).toSorted((a, b) => a - b)).toEqual([200, 409]);
    expect(await revokedAuditRows(world)).toHaveLength(1);
    expect(await sentJobs(world.db)).toHaveLength(3);
    const [winner] = answers.filter((answer) => answer.statusCode === 200);
    const reason = (await signatureRow(world, t1.signatureId)).revoke_reason;
    expect(winner?.body).toContain('revoked');
    expect((await revokedAuditRows(world))[0]?.metadata).toMatchObject({ reason_code: reason });
  },
);
