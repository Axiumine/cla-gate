// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { backendPid, realPostgresOnly, waitUntilBlocked, withConnections } from '../adapters/db/test-support.ts';
import {
  addSignatures,
  invalidationAuditRows,
  invalidationBy,
  majorOneOf,
  signatureStates,
} from './invalidation-fixture/test-support.ts';
import { sentJobs } from './jobs-fixture/test-support.ts';
import { brokenBy } from './publish-fixture/test-support.ts';
import { revocationBy, revocationWorld } from './revocation-fixture/test-support.ts';
import { invalidateMajor } from './signature-invalidate.ts';
import { invalidateActiveSignatures } from './signature-invalidate-queries.ts';
import { revokeSignature } from './signature-revoke.ts';
import { markSignatureRevoked } from './signature-revoke-queries.ts';

// The invalidation of a major (E15-S04) next to a revocation of one of its signatures, and in bulk, on a real server. The order is decided
// by a row lock and `pg_locks`, never by a timer: one session holds the signature row in an open transaction, the call of the other session
// waits for it, and what that call finds when the holder commits is what it decides on. PGlite has one session, so these run in the CI
// `postgres` job only; the same decisions are shown in sequence in signature-invalidate.test.ts and signature-revoke.test.ts.
// Tenant 1's installation-wide document has the signer's signature at major 1 (`t1.signatureId`) and three more, so four are in force.

/** The revocation world with three more signatures of tenant 1 at major 1, so that four are in force. */
async function signedWorld() {
  const base = await revocationWorld();
  const { db, t1 } = base;
  const added = await addSignatures(db, majorOneOf(t1), 3, 50_000);
  return { ...base, added, scope: { installationId: t1.installationId } };
}

/** {@link signedWorld} with two sessions on the database of the run: the holder of a lock and the call that waits for it. */
async function raceWorld() {
  const base = await signedWorld();
  const { t1, added, scope } = base;
  const connections = withConnections(2);
  const holder = connections.get(0);
  const waiting = connections.get(1);
  const waitingPid = await backendPid(waiting);
  const contested = added[0] ?? 0;
  /** Opens a transaction on the holder's session that revokes the contested signature and does not commit. */
  const holdRevocation = async () => {
    await sql`begin`.execute(holder);
    await markSignatureRevoked(holder, scope, {
      signatureId: contested,
      revokedBy: t1.publisherId,
      reason: 'signer_request',
    });
  };
  return { ...base, holder, waiting, waitingPid, contested, holdRevocation };
}

test('with nothing in its way the invalidation revokes all four signatures in force: the same call as the races below, on whatever engine runs the suite', async () => {
  const { db, t1, scope, queue } = await signedWorld();
  const count = await invalidateMajor({ db, enqueuer: queue }, scope, invalidationBy(t1, majorOneOf(t1), 4));
  const states = await signatureStates(db, t1.documentId);
  expect([count, states.filter((row) => row.revoked_at !== null).length]).toEqual([4, 4]);
  expect(await invalidationAuditRows(db)).toHaveLength(1);
});

realPostgresOnly(
  'an invalidation that waits for a revocation of one of its signatures skips it after the lock: the three others are revoked once, the contested one keeps the reason of its revocation, and one audit row counts three',
  async () => {
    const world = await raceWorld();
    const { db, t1, scope, waiting, waitingPid, holder, contested, queue } = world;
    await world.holdRevocation();
    const change = brokenBy(
      invalidateMajor({ db: waiting, enqueuer: queue }, scope, invalidationBy(t1, majorOneOf(t1), 3)),
    );
    await waitUntilBlocked(db, waitingPid);
    await sql`commit`.execute(holder);
    expect(await change).toBeNull();
    const states = await signatureStates(db, t1.documentId);
    expect(states.every((row) => row.revoked_at !== null)).toBe(true);
    expect(states.find((row) => row.id === contested)).toMatchObject({
      revoked_by: t1.publisherId,
      revoke_reason: 'signer_request',
    });
    expect(states.filter((row) => row.revoke_reason === 'maintainer_decision')).toHaveLength(3);
    expect(new Set(states.filter((row) => row.id !== contested).map((row) => row.revoked_at?.getTime())).size).toBe(1);
    expect((await invalidationAuditRows(db)).map((row) => row.metadata)).toEqual([
      { major: 1, count: 3, reason_code: 'maintainer_decision' },
    ]);
    expect(await sentJobs(db)).toHaveLength(2);
  },
);

realPostgresOnly(
  'an invalidation that was confirmed for four signatures and finds three after the lock is count_changed: only the contested signature is revoked, by its own revocation, and nothing else is written',
  async () => {
    const world = await raceWorld();
    const { db, t1, scope, waiting, waitingPid, holder, contested, queue } = world;
    await world.holdRevocation();
    const change = brokenBy(
      invalidateMajor({ db: waiting, enqueuer: queue }, scope, invalidationBy(t1, majorOneOf(t1), 4)),
    );
    await waitUntilBlocked(db, waitingPid);
    await sql`commit`.execute(holder);
    expect(await change).toEqual({ rule: 'count_changed', details: undefined });
    const states = await signatureStates(db, t1.documentId);
    expect(states.filter((row) => row.revoked_at !== null).map((row) => [row.id, row.revoke_reason])).toEqual([
      [contested, 'signer_request'],
    ]);
    expect(await invalidationAuditRows(db)).toEqual([]);
    expect(await sentJobs(db)).toEqual([]);
  },
);

realPostgresOnly(
  'a revocation that waits for an invalidation of its signature finds it revoked after the lock: already_revoked, and the signature keeps the record of the invalidation',
  async () => {
    const world = await raceWorld();
    const { db, t1, scope, waiting, waitingPid, holder, contested, queue } = world;
    await sql`begin`.execute(holder);
    await invalidateActiveSignatures(holder, scope, {
      documentId: t1.documentId,
      major: 1,
      revokedBy: t1.publisherId,
      reason: 'legal_request',
    });
    const change = brokenBy(revokeSignature({ db: waiting, enqueuer: queue }, scope, revocationBy(t1, contested)));
    await waitUntilBlocked(db, waitingPid);
    await sql`commit`.execute(holder);
    expect(await change).toEqual({ rule: 'already_revoked', details: undefined });
    const states = await signatureStates(db, t1.documentId);
    expect(states.map((row) => row.revoke_reason)).toEqual([
      'legal_request',
      'legal_request',
      'legal_request',
      'legal_request',
    ]);
    expect(await db.selectFrom('audit_log').select('id').where('action', '=', 'signature.revoked').execute()).toEqual(
      [],
    );
  },
);

realPostgresOnly(
  'an invalidation of 1,000 signatures is one transaction: every one carries the same instant, one audit row counts them all, and the sweeps are sent with it',
  async () => {
    const { db, t1, queue } = await revocationWorld();
    const scope = { installationId: t1.installationId };
    await addSignatures(db, majorOneOf(t1), 1000, 100_000);
    const count = await invalidateMajor({ db, enqueuer: queue }, scope, invalidationBy(t1, majorOneOf(t1), 1001));
    const { rows } = await sql<{ revoked: number; instants: number }>`
      select count(*)::int as revoked, count(distinct revoked_at)::int as instants
      from signatures where document_id = ${t1.documentId} and revoked_at is not null`.execute(db);
    expect([count, ...rows.map((row) => [row.revoked, row.instants])]).toEqual([1001, [1001, 1]]);
    expect((await invalidationAuditRows(db)).map((row) => row.metadata)).toEqual([
      { major: 1, count: 1001, reason_code: 'maintainer_decision' },
    ]);
    expect(await sentJobs(db)).toHaveLength(2);
  },
);
