// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { erasurePreviewSchema, erasureResultSchema } from '../../../shared/erasure.ts';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { dataChecksums, erasureWorld } from './erasure-fixture/test-support.ts';

// `GET …/erasure-preview` and `POST …/erasures` (E16-S04): who may call them, what the query string and the body may carry,
// and what the answer is. What the erasure does to the data is in services/signer-erasure.test.ts, the second tenant in
// erasure-tenants.test.ts and the log in erasure-log.test.ts.

const errorCode = (body: unknown): string => errorResponseSchema.parse(body).error.code;

const MEMBER1 = 31_004;

test('an org admin sees how many signatures and rows of personal data the installation holds for a person, and no personal data', async () => {
  const { preview, t1, people } = await erasureWorld();
  const response = await preview('admin1', t1.installationId, `?githubUserId=${MEMBER1}`);
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(erasurePreviewSchema.parse(response.json())).toEqual({
    githubUserId: MEMBER1,
    signatures: 1,
    signerPiiRows: 1,
    allowlistEntries: 0,
    corporateApprovals: 0,
  });
  expect(Object.keys(response.json()).toSorted((a, b) => a.localeCompare(b))).toEqual([
    'allowlistEntries',
    'corporateApprovals',
    'githubUserId',
    'signatures',
    'signerPiiRows',
  ]);
  for (const personal of [people.member1.login, 'Name 31004', 'u31004@example.test']) {
    expect(response.body).not.toContain(personal);
  }
});

test.each([
  ['admin1', 'an org admin', 200, null],
  ['repoAdmin1', 'a repository admin only', 403, 'forbidden'],
  ['member1', 'a plain member', 404, 'not_found'],
  ['outsider', 'somebody GitHub knows nothing about', 404, 'not_found'],
  ['admin2', 'the admin of another tenant', 404, 'not_found'],
] as const)('the preview as %s (%s) is %i', async (who, _role, status, code) => {
  const { preview, t1 } = await erasureWorld();
  const response = await preview(who, t1.installationId, `?githubUserId=${MEMBER1}`);
  expect(response.statusCode).toBe(status);
  if (code !== null) {
    expect(errorCode(response.json())).toBe(code);
  }
});

test.each([
  ['admin1', 'an org admin', 200, null],
  ['repoAdmin1', 'a repository admin only', 403, 'forbidden'],
  ['member1', 'a plain member', 404, 'not_found'],
  ['outsider', 'somebody GitHub knows nothing about', 404, 'not_found'],
  ['admin2', 'the admin of another tenant', 404, 'not_found'],
] as const)('the erasure as %s (%s) is %i, and a refused call erases nothing', async (who, _role, status, code) => {
  const { erase, t1, db, signatureRows } = await erasureWorld();
  const before = { tenants: await dataChecksums(db), signatures: await signatureRows() };
  const response = await erase(who, t1.installationId, { githubUserId: MEMBER1, expectedRows: 1 });
  expect(response.statusCode).toBe(status);
  if (code !== null) {
    expect(errorCode(response.json())).toBe(code);
    expect(await dataChecksums(db)).toEqual(before.tenants);
    expect(await signatureRows()).toEqual(before.signatures);
  }
});

test('a request with no session is a 401 on both routes', async () => {
  const { preview, erase, t1 } = await erasureWorld();
  expect((await preview(null, t1.installationId, `?githubUserId=${MEMBER1}`)).statusCode).toBe(401);
  expect((await erase(null, t1.installationId, { githubUserId: MEMBER1, expectedRows: 1 })).statusCode).toBe(401);
});

test('an erasure without the CSRF token is a 403 csrf_invalid and erases nothing', async () => {
  const { app, db, login, people, t1 } = await erasureWorld();
  const admin = await login(people.admin1.githubId);
  const before = await dataChecksums(db);
  const response = await app.inject({
    method: 'POST',
    url: `/api/installations/${t1.installationId}/erasures`,
    headers: { cookie: admin.cookie, origin: admin.headers.origin },
    payload: { githubUserId: MEMBER1, expectedRows: 1 },
  });
  expect([response.statusCode, errorCode(response.json())]).toEqual([403, 'csrf_invalid']);
  expect(await dataChecksums(db)).toEqual(before);
});

test('a POST with no Origin, no session and no body is refused by the Origin check, not by the validation of a body it never reads', async () => {
  const { app, t1 } = await erasureWorld();
  const response = await app.inject({ method: 'POST', url: `/api/installations/${t1.installationId}/erasures` });
  expect([response.statusCode, errorCode(response.json())]).toEqual([403, 'origin_not_allowed']);
});

test.each(['abc', '0', '-1', '01', '1.5', '1e3', '9007199254740993', ' 5', '5%20'])(
  'a preview for githubUserId=%s is a 400',
  async (value) => {
    const { preview, t1 } = await erasureWorld();
    const response = await preview('admin1', t1.installationId, `?githubUserId=${value}`);
    expect([response.statusCode, errorCode(response.json())]).toEqual([400, 'bad_request']);
  },
);

test.each([
  ['no person', ''],
  ['an empty person', '?githubUserId='],
  ['a login instead of an id', '?login=octocat'],
  ['the person twice', `?githubUserId=${MEMBER1}&githubUserId=${MEMBER1}`],
  ['a parameter nobody defined', `?githubUserId=${MEMBER1}&limit=1`],
  ['the installation named in the query', `?githubUserId=${MEMBER1}&installationId=2`],
])('a preview with %s is a 400', async (_name, query) => {
  const { preview, t1 } = await erasureWorld();
  const response = await preview('admin1', t1.installationId, query);
  expect([response.statusCode, errorCode(response.json())]).toEqual([400, 'bad_request']);
});

test.each([
  ['an empty body', {}],
  ['no expected count', { githubUserId: MEMBER1 }],
  ['no person', { expectedRows: 1 }],
  ['the person as text', { githubUserId: '31004', expectedRows: 1 }],
  ['the count as text', { githubUserId: MEMBER1, expectedRows: '1' }],
  ['a negative count', { githubUserId: MEMBER1, expectedRows: -1 }],
  ['a fractional count', { githubUserId: MEMBER1, expectedRows: 1.5 }],
  ['a person who is no id', { githubUserId: 0, expectedRows: 1 }],
  ['a number beyond what a number holds exactly', { githubUserId: 1e21, expectedRows: 1 }],
  ['a login next to the id', { githubUserId: MEMBER1, expectedRows: 1, login: 'octocat' }],
  ['an email next to the id', { githubUserId: MEMBER1, expectedRows: 1, email: 'a@example.test' }],
  ['the installation in the body', { githubUserId: MEMBER1, expectedRows: 1, installationId: 2 }],
])('an erasure with %s is a 400 and erases nothing', async (_name, payload) => {
  const { erase, t1, db } = await erasureWorld();
  const before = await dataChecksums(db);
  const response = await erase('admin1', t1.installationId, payload);
  expect([response.statusCode, errorCode(response.json())]).toEqual([400, 'bad_request']);
  expect(await dataChecksums(db)).toEqual(before);
});

test.each([
  ['a JSON array', '[31004, 1]', 'application/json'],
  ['JSON null', 'null', 'application/json'],
  ['text that is not JSON', 'erase member1', 'application/json'],
])('an erasure whose body is %s is a 400', async (_name, body, contentType) => {
  const { eraseRaw, t1 } = await erasureWorld();
  expect((await eraseRaw(t1.installationId, body, contentType)).statusCode).toBe(400);
});

test.each(['abc', '0', '-1', '01', '1.5'])(
  'an installation id of %s in the path is a 400 on both routes',
  async (id) => {
    const { ask } = await erasureWorld();
    const preview = await ask('admin1', {
      method: 'GET',
      url: `/api/installations/${id}/erasure-preview?githubUserId=${MEMBER1}`,
    });
    const erase = await ask('admin1', {
      method: 'POST',
      url: `/api/installations/${id}/erasures`,
      payload: { githubUserId: MEMBER1, expectedRows: 1 },
    });
    expect([preview.statusCode, erase.statusCode]).toEqual([400, 400]);
  },
);

test('a person with no signature in the installation is the same 404 not_found on both routes, whether they signed elsewhere or nowhere', async () => {
  const { preview, erase, t1, people } = await erasureWorld();
  for (const githubUserId of [people.admin2.githubId, 987_654]) {
    const seen = await preview('admin1', t1.installationId, `?githubUserId=${githubUserId}`);
    const erased = await erase('admin1', t1.installationId, { githubUserId, expectedRows: 0 });
    expect([seen.statusCode, errorCode(seen.json())], String(githubUserId)).toEqual([404, 'not_found']);
    expect([erased.statusCode, errorCode(erased.json())], String(githubUserId)).toEqual([404, 'not_found']);
  }
});

test.each([
  ['more than there are', 2],
  ['none', 0],
])('an erasure that expects %s is a 409 count_changed that changes nothing', async (_name, expectedRows) => {
  const { erase, t1, db, signatureRows, ask, people } = await erasureWorld();
  const before = { tenants: await dataChecksums(db), signatures: await signatureRows() };
  const response = await erase('admin1', t1.installationId, { githubUserId: MEMBER1, expectedRows });
  expect([response.statusCode, errorCode(response.json())]).toEqual([409, 'count_changed']);
  expect(await dataChecksums(db)).toEqual(before.tenants);
  expect(await signatureRows()).toEqual(before.signatures);
  const user = await db
    .selectFrom('users')
    .select(['login', 'name'])
    .where('github_id', '=', MEMBER1)
    .executeTakeFirstOrThrow();
  expect(user).toEqual({ login: people.member1.login, name: 'Name 31004' });
  expect(
    await db.selectFrom('sessions').select('id').where('user_id', '=', people.member1.userId).execute(),
  ).toHaveLength(1);
  expect((await ask('member1', { method: 'GET', url: '/api/auth/session' })).statusCode).toBe(200);
});

test('an erasure with the confirmed count deletes that many rows, answers erasedRows and is not cached', async () => {
  const { erase, preview, t1, db } = await erasureWorld();
  const response = await erase('admin1', t1.installationId, { githubUserId: MEMBER1, expectedRows: 1 });
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(erasureResultSchema.parse(response.json())).toEqual({ erasedRows: 1 });
  expect(Object.keys(response.json())).toEqual(['erasedRows']);
  expect(
    await db.selectFrom('signer_pii').select('signature_id').where('user_id', '=', t1.signer.userId).execute(),
  ).toEqual([]);
  const after = await preview('admin1', t1.installationId, `?githubUserId=${MEMBER1}`);
  expect(after.json()).toEqual({
    githubUserId: MEMBER1,
    signatures: 1,
    signerPiiRows: 0,
    allowlistEntries: 0,
    corporateApprovals: 0,
  });
});

test('erasing again is allowed and deletes nothing: the count to confirm is then zero', async () => {
  const { erase, t1 } = await erasureWorld();
  await erase('admin1', t1.installationId, { githubUserId: MEMBER1, expectedRows: 1 });
  const stale = await erase('admin1', t1.installationId, { githubUserId: MEMBER1, expectedRows: 1 });
  const again = await erase('admin1', t1.installationId, { githubUserId: MEMBER1, expectedRows: 0 });
  expect([stale.statusCode, errorCode(stale.json())]).toEqual([409, 'count_changed']);
  expect([again.statusCode, again.json()]).toEqual([200, { erasedRows: 0 }]);
});

test('a failure of the database during the erasure is a 500 that tells nothing, and the personal data is still there', async () => {
  const { erase, db, t1, people } = await erasureWorld();
  await sql`drop function erase_signer_pii(bigint, bigint, bigint)`.execute(db);
  const before = await dataChecksums(db);

  const response = await erase('admin1', t1.installationId, { githubUserId: MEMBER1, expectedRows: 1 });

  expect([response.statusCode, errorCode(response.json())]).toEqual([500, 'internal_server_error']);
  expect(response.body).not.toContain('erase_signer_pii');
  expect(response.body).not.toContain(people.member1.login);
  expect(await dataChecksums(db)).toEqual(before);
});
