// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { SIGNATURE_REVOKE_PATH } from '../../../shared/signature-revoke.ts';
import { sentJobs } from '../../services/jobs-fixture/test-support.ts';
import { errorCodeOf, tablesOf, withoutRequestId } from './document-fixture/test-support.ts';
import { suspendTenantOne } from './repository-document-fixture/test-support.ts';
import {
  MAINTAINER_DECISION,
  revokeAs,
  revokedAnswerOf,
  revokedAuditRows,
  revokePath,
  revokeWith,
  revokeWorld,
  signatureRow,
} from './signature-revoke-fixture/test-support.ts';

// `POST /api/installations/:installationId/signatures/:signatureId/revoke` (E15-S03): what a revocation writes, answers and audits,
// on the real application over PGlite. The roles are in signature-revoke-roles.test.ts, the other tenant's ids in
// signature-revoke-tenants.test.ts, the pull requests in signature-revoke-prospective.test.ts and signature-revoke-flow.test.ts.

test('the org admin revokes a signature: 200 with the signature as revoked and the instant the database stamped, nothing cached, and the three columns are set', async () => {
  const world = await revokeWorld();
  const { t1, t2, people } = world;
  const response = await revokeAs(world, 'admin1', t1.installationId, t1.signatureId);
  const answer = revokedAnswerOf(response);
  const row = await signatureRow(world, t1.signatureId);
  expect([response.statusCode, response.headers['cache-control']]).toEqual([200, 'no-store']);
  expect(answer).toEqual({
    signature: { id: t1.signatureId, state: 'revoked', revokedAt: row.revoked_at?.toISOString() },
    reevaluating: 0,
  });
  expect(row).toMatchObject({ revoked_by: people.admin1.userId, revoke_reason: 'maintainer_decision' });
  expect(row.revoked_at).toBeInstanceOf(Date);
  const other = await signatureRow(world, t2.signatureId);
  expect([other.revoked_at, other.revoked_by, other.revoke_reason]).toEqual([null, null, null]);
});

test.each(['signer_request', 'maintainer_decision', 'legal_request', 'other'] as const)(
  'the reason code %s is stored as given',
  async (reasonCode) => {
    const world = await revokeWorld();
    const { t1 } = world;
    const response = await revokeWith(
      world,
      'admin1',
      { installationId: t1.installationId, signatureId: t1.signatureId },
      { reasonCode },
    );
    expect(response.statusCode).toBe(200);
    expect((await signatureRow(world, t1.signatureId)).revoke_reason).toBe(reasonCode);
    const [audit, ...more] = await revokedAuditRows(world);
    expect(more).toEqual([]);
    expect(audit?.metadata).toMatchObject({ reason_code: reasonCode });
  },
);

test('one audit row is written: the signature as the subject, the document, the version, the major, the signer by GitHub id and the reason code, and no name', async () => {
  const world = await revokeWorld();
  const { t1, people } = world;
  await revokeWith(
    world,
    'admin1',
    { installationId: t1.installationId, signatureId: t1.signatureId },
    { reasonCode: 'legal_request' },
  );
  const [audit, ...more] = await revokedAuditRows(world);
  const signature = await signatureRow(world, t1.signatureId);
  expect(more).toEqual([]);
  expect(audit).toMatchObject({
    installation_id: t1.installationId,
    actor_github_id: people.admin1.githubId,
    action: 'signature.revoked',
    subject_type: 'signature',
    subject_id: t1.signatureId,
    metadata: {
      document_id: t1.documentId,
      version_id: signature.version_id,
      major: 1,
      user_github_id: people.member1.githubId,
      reason_code: 'legal_request',
    },
  });
  expect(Object.keys(audit?.metadata ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual([
    'document_id',
    'major',
    'reason_code',
    'user_github_id',
    'version_id',
  ]);
  expect(JSON.stringify(audit)).not.toContain(`Name ${people.member1.githubId}`);
  expect(JSON.stringify(audit)).not.toContain(`u${people.member1.githubId}@`);
});

test('a signature revoked already is 409 already_revoked: no second audit row, no second job, and the first revocation stays as it was', async () => {
  const world = await revokeWorld();
  const { t1, people } = world;
  const first = await revokeWith(
    world,
    'admin1',
    { installationId: t1.installationId, signatureId: t1.signatureId },
    { reasonCode: 'signer_request' },
  );
  const kept = await signatureRow(world, t1.signatureId);
  const jobs = await sentJobs(world.db);
  const before = await tablesOf(world);
  const again = await revokeWith(
    world,
    'admin1',
    { installationId: t1.installationId, signatureId: t1.signatureId },
    { reasonCode: 'legal_request' },
  );
  expect([first.statusCode, again.statusCode, errorCodeOf(again)]).toEqual([200, 409, 'already_revoked']);
  expect(await signatureRow(world, t1.signatureId)).toEqual(kept);
  expect(kept).toMatchObject({ revoked_by: people.admin1.userId, revoke_reason: 'signer_request' });
  expect(await revokedAuditRows(world)).toHaveLength(1);
  expect(await sentJobs(world.db)).toEqual(jobs);
  expect(await tablesOf(world)).toEqual(before);
});

const BAD_BODIES: readonly (readonly [string, object])[] = [
  ['no reason', {}],
  ['a reason outside the four', { reasonCode: 'because' }],
  ['an empty reason', { reasonCode: '' }],
  ['a reason in capitals', { reasonCode: 'OTHER' }],
  ['a reason that is not text', { reasonCode: 1 }],
  ['a free text next to a good reason', { reasonCode: 'other', note: 'zzzz' }],
  ['a body that is not an object', ['other']],
];

test('a body without exactly one of the four reason codes is 400 bad_request, whatever else it holds, and nothing changes', async () => {
  const world = await revokeWorld();
  const { t1 } = world;
  const before = await tablesOf(world);
  for (const [label, body] of BAD_BODIES) {
    const response = await revokeWith(
      world,
      'admin1',
      { installationId: t1.installationId, signatureId: t1.signatureId },
      body,
    );
    expect([label, response.statusCode, errorCodeOf(response)]).toEqual([label, 400, 'bad_request']);
    expect(response.body).not.toContain('zzzz');
  }
  expect(await tablesOf(world)).toEqual(before);
  expect(await revokedAuditRows(world)).toEqual([]);
});

test('a signature id in the path that is not in plain digits is 400 bad_request: only such an id names a signature', async () => {
  const world = await revokeWorld();
  for (const id of ['0', '01', '-1', 'abc', '1.5', '1e3', '9007199254740993']) {
    const response = await revokeAs(world, 'admin1', world.t1.installationId, id);
    expect([id, response.statusCode, errorCodeOf(response)]).toEqual([id, 400, 'bad_request']);
  }
  expect(await revokedAuditRows(world)).toEqual([]);
});

test('an unknown signature is 404 not_found, the answer of an id that exists nowhere', async () => {
  const world = await revokeWorld();
  const response = await revokeAs(world, 'admin1', world.t1.installationId, 987_654);
  expect([response.statusCode, errorCodeOf(response)]).toEqual([404, 'not_found']);
  expect(await revokedAuditRows(world)).toEqual([]);
});

test('a suspended tenant cannot revoke: 409 installation_suspended, and the signature stays in force', async () => {
  const world = await revokeWorld();
  const { t1 } = world;
  await suspendTenantOne(world);
  const response = await revokeAs(world, 'admin1', t1.installationId, t1.signatureId);
  expect([response.statusCode, errorCodeOf(response)]).toEqual([409, 'installation_suspended']);
  expect((await signatureRow(world, t1.signatureId)).revoked_at).toBeNull();
  expect(await revokedAuditRows(world)).toEqual([]);
});

test('nobody signed in is 401; a request without the CSRF token is 403 csrf_invalid and one from another origin 403 origin_not_allowed, and nothing changes', async () => {
  const world = await revokeWorld();
  const { t1, people } = world;
  const admin = await world.login(people.admin1.githubId);
  const url = revokePath(t1.installationId, t1.signatureId);
  const send = (headers: Record<string, string>) =>
    world.app.inject({ method: 'POST', url, headers, payload: MAINTAINER_DECISION });
  const anonymous = await revokeAs(world, null, t1.installationId, t1.signatureId);
  const noToken = await send({ cookie: admin.cookie, origin: admin.headers.origin });
  const wrongToken = await send({ ...admin.headers, 'x-csrf-token': 'zzzz' });
  const foreign = await send({ ...admin.headers, origin: 'https://evil.example' });
  expect([anonymous, noToken, wrongToken, foreign].map((answer) => answer.statusCode)).toEqual([401, 403, 403, 403]);
  expect([noToken, wrongToken, foreign].map(errorCodeOf)).toEqual([
    'csrf_invalid',
    'csrf_invalid',
    'origin_not_allowed',
  ]);
  expect((await signatureRow(world, t1.signatureId)).revoked_at).toBeNull();
  expect(await revokedAuditRows(world)).toEqual([]);
  const served = await send(admin.headers);
  expect(served.statusCode).toBe(200);
});

test('the path is the one the contract names, and a GET to it finds no handler', async () => {
  const world = await revokeWorld();
  const { t1 } = world;
  expect(SIGNATURE_REVOKE_PATH).toBe('/api/installations/:installationId/signatures/:signatureId/revoke');
  const response = await world.ask('admin1', { method: 'GET', url: revokePath(t1.installationId, t1.signatureId) });
  expect(response.statusCode).toBe(404);
  expect((await signatureRow(world, t1.signatureId)).revoked_at).toBeNull();
  expect(withoutRequestId(response)).toContain('not_found');
});
