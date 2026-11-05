// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { INVALIDATIONS_PATH } from '../../../shared/signature-invalidate.ts';
import {
  addSignatures,
  invalidationAuditRows,
  majorOneOf,
  publishMajor,
  signatureStates,
} from '../../services/invalidation-fixture/test-support.ts';
import { sentJobs } from '../../services/jobs-fixture/test-support.ts';
import { testApp } from '../../test-support.ts';
import { errorCodeOf, tablesOf, withoutRequestId } from './document-fixture/test-support.ts';
import { CLA_BODY_LIMIT } from './limits.ts';
import { suspendTenantOne } from './repository-document-fixture/test-support.ts';
import {
  bodyFor,
  invalidateAs,
  invalidatedAnswerOf,
  invalidateWith,
  invalidationsPath,
} from './signature-invalidate-fixture/test-support.ts';
import { enforceDocuments, revokeWorld } from './signature-revoke-fixture/test-support.ts';

// `POST /api/installations/:installationId/documents/:documentId/invalidations` (E15-S04): what an invalidation of a major writes,
// answers and audits, on the real application over PGlite. Tenant 1's installation-wide document has one signature at major 1, the
// signer's (`t1.signatureId`); `crowd` adds two. The roles are in signature-invalidate-roles.test.ts, the other tenant's ids in
// signature-invalidate-tenants.test.ts, the sweeps and the failing queue in signature-invalidate-sweeps.test.ts.

/** The revocation world with the repositories on, and `extra` more signatures of tenant 1 at major 1. */
async function crowd(extra = 2) {
  const world = await revokeWorld();
  await enforceDocuments(world);
  const added = await addSignatures(world.db, majorOneOf(world.t1), extra, 50_000);
  const target = { installationId: world.t1.installationId, documentId: world.t1.documentId };
  return { ...world, added, target };
}

test('the org admin invalidates a major: 200 with the count, nothing cached, and every signature of it is revoked by one statement for one reason', async () => {
  const world = await crowd();
  const { db, t1, people, target } = world;
  const response = await invalidateAs(world, 'admin1', target, 3);
  const states = await signatureStates(db, t1.documentId);
  expect([response.statusCode, response.headers['cache-control']]).toEqual([200, 'no-store']);
  expect(invalidatedAnswerOf(response)).toEqual({ invalidated: 3 });
  expect(states).toHaveLength(3);
  expect(new Set(states.map((row) => row.revoked_at?.getTime())).size).toBe(1);
  expect(states.map((row) => [row.revoked_by, row.revoke_reason])).toEqual(
    states.map(() => [people.admin1.userId, 'maintainer_decision']),
  );
});

test.each(['signer_request', 'maintainer_decision', 'legal_request', 'other'] as const)(
  'the reason code %s is stored on every signature and in the audit row as given',
  async (reasonCode) => {
    const world = await crowd();
    const { db, t1, target } = world;
    const response = await invalidateWith(world, 'admin1', target, bodyFor(3, 1, reasonCode));
    expect(response.statusCode).toBe(200);
    expect((await signatureStates(db, t1.documentId)).map((row) => row.revoke_reason)).toEqual([
      reasonCode,
      reasonCode,
      reasonCode,
    ]);
    expect((await invalidationAuditRows(db)).map((row) => row.metadata)).toEqual([
      { major: 1, count: 3, reason_code: reasonCode },
    ]);
  },
);

test('one audit row is written for the whole action, not one for each signature: the document as the subject, the major, the count and the reason code, and no name', async () => {
  const world = await crowd();
  const { db, t1, people, target } = world;
  await invalidateAs(world, 'admin1', target, 3);
  const rows = await db.selectFrom('audit_log').selectAll().where('installation_id', '=', t1.installationId).execute();
  const [audit, ...more] = await invalidationAuditRows(db);
  expect(more).toEqual([]);
  expect(audit).toMatchObject({
    installation_id: t1.installationId,
    actor_github_id: people.admin1.githubId,
    action: 'signatures.invalidated',
    subject_type: 'document',
    subject_id: t1.documentId,
    metadata: { major: 1, count: 3, reason_code: 'maintainer_decision' },
  });
  expect(rows.filter((row) => row.action.startsWith('signature'))).toEqual([audit]);
  expect(JSON.stringify(audit)).not.toContain(`Name ${people.member1.githubId}`);
  expect(JSON.stringify(audit)).not.toContain(`u${people.member1.githubId}@`);
});

test('a count that is not the confirmed one is 409 count_changed and nothing is revoked: no row of any table changes, no audit row, no job', async () => {
  const world = await crowd();
  const { db, t1, target } = world;
  const before = await tablesOf(world);
  const answers = [await invalidateAs(world, 'admin1', target, 2), await invalidateAs(world, 'admin1', target, 4)];
  expect(answers.map((answer) => [answer.statusCode, errorCodeOf(answer)])).toEqual([
    [409, 'count_changed'],
    [409, 'count_changed'],
  ]);
  expect(await tablesOf(world)).toEqual(before);
  expect((await signatureStates(db, t1.documentId)).map((row) => row.revoked_at)).toEqual([null, null, null]);
  expect(await invalidationAuditRows(db)).toEqual([]);
  expect(await sentJobs(db)).toEqual([]);
});

test('a major with no signature in force is 409 nothing_to_invalidate, the one that does not exist and the one that was invalidated already alike, and nothing changes', async () => {
  const world = await crowd();
  const { db, target } = world;
  const unknown = await invalidateWith(world, 'admin1', target, bodyFor(1, 2));
  const first = await invalidateAs(world, 'admin1', target, 3);
  const jobs = await sentJobs(db);
  const before = await tablesOf(world);
  const again = await invalidateAs(world, 'admin1', target, 3);
  expect([unknown, first, again].map((answer) => answer.statusCode)).toEqual([409, 200, 409]);
  expect([unknown, again].map(errorCodeOf)).toEqual(['nothing_to_invalidate', 'nothing_to_invalidate']);
  expect(await tablesOf(world)).toEqual(before);
  expect(await invalidationAuditRows(db)).toHaveLength(1);
  expect(await sentJobs(db)).toEqual(jobs);
});

test('an invalidation of one major leaves the signatures of the next major in force', async () => {
  const world = await crowd();
  const { db, t1, target } = world;
  const second = await publishMajor(db, t1, 2);
  const [atSecond] = await addSignatures(db, second, 1, 60_000);
  const response = await invalidateAs(world, 'admin1', target, 3);
  const states = await signatureStates(db, t1.documentId);
  expect(invalidatedAnswerOf(response)).toEqual({ invalidated: 3 });
  expect(states.filter((row) => row.revoked_at === null).map((row) => [row.id, row.major])).toEqual([[atSecond, 2]]);
});

const BAD_BODIES: readonly (readonly [string, object])[] = [
  ['no body fields', {}],
  ['no major', { reasonCode: 'other', expectedCount: 3 }],
  ['major 0', bodyFor(3, 0)],
  ['a negative major', bodyFor(3, -1)],
  ['a major that is not whole', bodyFor(3, 1.5)],
  ['a major written as text', { ...bodyFor(3), major: '1' }],
  ['a major the column cannot hold', bodyFor(3, 2_147_483_648)],
  ['a major that is null', { ...bodyFor(3), major: null }],
  ['no expected count', { major: 1, reasonCode: 'other' }],
  ['an expected count of 0', bodyFor(0)],
  ['a negative expected count', bodyFor(-1)],
  ['an expected count that is not whole', bodyFor(2.5)],
  ['an expected count written as text', { ...bodyFor(3), expectedCount: '3' }],
  ['no reason', { major: 1, expectedCount: 3 }],
  ['a reason outside the four', bodyFor(3, 1, 'because')],
  ['a reason in capitals', bodyFor(3, 1, 'OTHER')],
  ['a free text next to good fields', { ...bodyFor(3), note: 'zzzz' }],
  ['a body that is not an object', [bodyFor(3)]],
];

test('a body without exactly a whole major of 1 or more, a count of 1 or more and one of the four reason codes is 400 bad_request, whatever else it holds, and nothing changes', async () => {
  const world = await crowd();
  const before = await tablesOf(world);
  for (const [label, body] of BAD_BODIES) {
    const response = await invalidateWith(world, 'admin1', world.target, body);
    expect([label, response.statusCode, errorCodeOf(response)]).toEqual([label, 400, 'bad_request']);
    expect(response.body).not.toContain('zzzz');
  }
  expect(await tablesOf(world)).toEqual(before);
  expect(await invalidationAuditRows(world.db)).toEqual([]);
});

test('a body of exactly 512 KiB is read (and refused as a bad body) and one byte more is 413 payload_too_large, with nothing changed', async () => {
  const world = await crowd();
  const frame = JSON.stringify({ ...bodyFor(3), reasonCode: '' }).length;
  const bodyOf = (bytes: number) => ({ ...bodyFor(3), reasonCode: 'r'.repeat(bytes - frame) });
  const before = await tablesOf(world);
  const atLimit = await invalidateWith(world, 'admin1', world.target, bodyOf(CLA_BODY_LIMIT));
  const over = await invalidateWith(world, 'admin1', world.target, bodyOf(CLA_BODY_LIMIT + 1));
  expect([atLimit.statusCode, errorCodeOf(atLimit)]).toEqual([400, 'bad_request']);
  expect([over.statusCode, errorCodeOf(over)]).toEqual([413, 'payload_too_large']);
  expect(await tablesOf(world)).toEqual(before);
});

test('a document id in the path that is not in plain digits is 400 bad_request: only such an id names a document', async () => {
  const world = await crowd();
  for (const id of ['0', '01', '-1', 'abc', '1.5', '1e3', '9007199254740993']) {
    const response = await invalidateAs(
      world,
      'admin1',
      { installationId: world.t1.installationId, documentId: id },
      3,
    );
    expect([id, response.statusCode, errorCodeOf(response)]).toEqual([id, 400, 'bad_request']);
  }
  expect(await invalidationAuditRows(world.db)).toEqual([]);
});

test('an unknown document is 404 not_found, the answer of an id that exists nowhere', async () => {
  const world = await crowd();
  const response = await invalidateAs(
    world,
    'admin1',
    { installationId: world.t1.installationId, documentId: 987_654 },
    3,
  );
  expect([response.statusCode, errorCodeOf(response)]).toEqual([404, 'not_found']);
  expect(await invalidationAuditRows(world.db)).toEqual([]);
});

test('a suspended tenant cannot invalidate: 409 installation_suspended, and the signatures stay in force', async () => {
  const world = await crowd();
  await suspendTenantOne(world);
  const response = await invalidateAs(world, 'admin1', world.target, 3);
  expect([response.statusCode, errorCodeOf(response)]).toEqual([409, 'installation_suspended']);
  expect((await signatureStates(world.db, world.t1.documentId)).map((row) => row.revoked_at)).toEqual([
    null,
    null,
    null,
  ]);
  expect(await invalidationAuditRows(world.db)).toEqual([]);
});

test('nobody signed in is 401; a request without the CSRF token is 403 csrf_invalid and one from another origin 403 origin_not_allowed, and nothing changes', async () => {
  const world = await crowd();
  const { people, target } = world;
  const admin = await world.login(people.admin1.githubId);
  const send = (headers: Record<string, string>) =>
    world.app.inject({ method: 'POST', url: invalidationsPath(target), headers, payload: bodyFor(3) });
  const anonymous = await invalidateAs(world, null, target, 3);
  const noToken = await send({ cookie: admin.cookie, origin: admin.headers.origin });
  const wrongToken = await send({ ...admin.headers, 'x-csrf-token': 'zzzz' });
  const foreign = await send({ ...admin.headers, origin: 'https://evil.example' });
  expect([anonymous, noToken, wrongToken, foreign].map((answer) => answer.statusCode)).toEqual([401, 403, 403, 403]);
  expect([noToken, wrongToken, foreign].map(errorCodeOf)).toEqual([
    'csrf_invalid',
    'csrf_invalid',
    'origin_not_allowed',
  ]);
  expect(await invalidationAuditRows(world.db)).toEqual([]);
  expect((await send(admin.headers)).statusCode).toBe(200);
});

test('the path is the one the contract names, a GET to it finds no handler, and no route undoes, changes or removes an invalidation', async () => {
  const world = await crowd();
  expect(INVALIDATIONS_PATH).toBe('/api/installations/:installationId/documents/:documentId/invalidations');
  const response = await world.ask('admin1', { method: 'GET', url: invalidationsPath(world.target) });
  expect(response.statusCode).toBe(404);
  expect(withoutRequestId(response)).toContain('not_found');
  const { app } = await testApp();
  await app.ready();
  expect(
    app.routeAccess.filter((entry) => entry.url.includes('invalidat')).map((entry) => `${entry.method} ${entry.url}`),
  ).toEqual([
    'GET /api/installations/:installationId/documents/:documentId/invalidation-preview',
    'POST /api/installations/:installationId/documents/:documentId/invalidations',
  ]);
});
