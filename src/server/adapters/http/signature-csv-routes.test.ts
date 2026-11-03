// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { csvRecords, parseCsv } from '../../domain/csv-fixture/test-support.ts';
import {
  HOSTILE_DOCUMENT_NAME,
  HOSTILE_SEEDS,
  seedInstant,
  seedSignatures,
} from '../../services/export/export-fixture/test-support.ts';
import { csvPathOf, csvWorld } from './signature-csv-fixture/test-support.ts';

// `GET /api/installations/:installationId/documents/:documentId/signatures.csv` (E16-S03): who may read it, what the query
// string may carry, what the answer looks like. The tenants, the audit row and the limit are in signature-csv-tenants.test.ts,
// the stream that fails in signature-csv-failure.test.ts, the file in services/export.

const errorCode = (body: unknown): string => errorResponseSchema.parse(body).error.code;

test('an org admin downloads the signatures of an installation document: a CSV attachment named from the id and the date, not cached', async () => {
  const { get, t1 } = await csvWorld();
  const response = await get('admin1', t1.installationId, t1.documentId);
  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
  expect(response.headers['content-disposition']).toBe(
    `attachment; filename="signatures-${t1.documentId}-2026-11-02.csv"`,
  );
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.headers['content-length']).toBeUndefined();
  expect(response.rawPayload.subarray(0, 12).toString('utf8')).toBe('signature_id');
  const [row, ...rest] = csvRecords(response.body);
  expect(rest).toEqual([]);
  expect(row).toMatchObject({
    signature_id: String(t1.signatureId),
    github_user_id: String(t1.signer.githubId),
    login: `login-${t1.signer.githubId}`,
    document_id: String(t1.documentId),
    state: 'active',
    pii_erased: 'false',
  });
});

test.each([
  ['admin1', 'the installation document', 200, null],
  ['admin1', 'the repository document', 200, null],
  ['repoAdmin1', 'the repository document', 200, null],
  ['repoAdmin1', 'the installation document', 403, 'forbidden'],
  ['member1', 'the installation document', 404, 'not_found'],
  ['outsider', 'the repository document', 404, 'not_found'],
  ['admin2', 'the installation document', 404, 'not_found'],
] as const)('%s asks for %s and gets %i', async (who, which, status, code) => {
  const { get, t1 } = await csvWorld();
  const documentId = which === 'the installation document' ? t1.documentId : t1.scoped.documentId;
  const response = await get(who, t1.installationId, documentId);
  expect(response.statusCode).toBe(status);
  if (code !== null) {
    expect(errorCode(response.json())).toBe(code);
  }
});

test('a request with no session is a 401, a document that does not exist and one of another tenant are the same 404', async () => {
  const { get, t1, t2 } = await csvWorld();
  expect((await get(null, t1.installationId, t1.documentId)).statusCode).toBe(401);
  const unknown = await get('admin1', t1.installationId, 987_654);
  const foreign = await get('admin1', t1.installationId, t2.documentId);
  const crossed = await get('admin2', t2.installationId, t1.documentId);
  expect([unknown.statusCode, foreign.statusCode, crossed.statusCode]).toEqual([404, 404, 404]);
  expect(foreign.json()).toMatchObject({ error: { code: 'not_found' } });
  expect(foreign.body.replace(/"requestId":"[^"]+"/, '')).toBe(unknown.body.replace(/"requestId":"[^"]+"/, ''));
});

test.each(['abc', '0', '-1', '01', '1.5'])('the path .../documents/%s/signatures.csv is a 400', async (id) => {
  const { ask, t1 } = await csvWorld();
  const response = await ask('admin1', {
    method: 'GET',
    url: `/api/installations/${t1.installationId}/documents/${id}/signatures.csv`,
  });
  expect(response.statusCode).toBe(400);
});

test.each([
  ['a state that is not one of the four', 'state=pending'],
  ['an empty state', 'state='],
  ['a state in capitals', 'state=ALL'],
  ['from with no offset', 'from=2026-11-01T00:00:00'],
  ['to that is not an instant', 'to=yesterday'],
  ['from with four decimals', 'from=2026-11-01T00:00:00.0001Z'],
  ['a repeated state', 'state=active&state=revoked'],
  ['a parameter nobody defined', 'limit=10'],
  ['the installation named in the query', 'installationId=2'],
])('%s is a 400 bad_request', async (_name, query) => {
  const { get, t1 } = await csvWorld();
  const response = await get('admin1', t1.installationId, t1.documentId, `?${query}`);
  expect([response.statusCode, errorCode(response.json())]).toEqual([400, 'bad_request']);
});

test('the four states are accepted, the default is all, and the state selects the signatures of that state', async () => {
  const { db, get, t1 } = await csvWorld();
  await seedSignatures(db, t1, [
    { githubId: 71 },
    { githubId: 72, revoked: { afterMs: 5, byGithubId: 71, reason: 'signer_request' } },
  ]);
  const logins = async (query: string) => {
    const response = await get('admin1', t1.installationId, t1.documentId, query);
    expect(response.statusCode, query).toBe(200);
    return csvRecords(response.body).map((record) => record['github_user_id']);
  };
  const everybody = [String(t1.signer.githubId), '71', '72'];
  expect(await logins('')).toEqual(everybody);
  expect(await logins('?state=all')).toEqual(everybody);
  expect(await logins('?state=active')).toEqual([String(t1.signer.githubId), '71']);
  expect(await logins('?state=revoked')).toEqual(['72']);
  expect(await logins('?state=outdated')).toEqual([]);
});

test('from is inclusive and to is exclusive on the time of the signature, to the millisecond', async () => {
  const { db, get, t1 } = await csvWorld();
  const at = (offsetMs: number) => ({ githubId: 80 + offsetMs + 1, signedAtMs: 20_000 + offsetMs });
  await seedSignatures(db, t1, [at(-1), at(0), at(1), at(999), at(1000)]);
  const window = `from=${seedInstant(20_000).toISOString()}&to=${seedInstant(21_000).toISOString()}`;
  const who = async (query: string) =>
    csvRecords((await get('admin1', t1.installationId, t1.documentId, `?${query}`)).body).map(
      (record) => record['github_user_id'],
    );
  expect(await who(window)).toEqual(['81', '82', '1080']);
  expect(await who(`from=${seedInstant(20_001).toISOString()}`)).toEqual([
    String(t1.signer.githubId),
    '82',
    '1080',
    '1081',
  ]);
  expect(await who(`to=${seedInstant(20_000).toISOString()}`)).toEqual(['80']);
});

test('a document with no signatures answers the header row alone', async () => {
  const { get, scopedTarget, t1 } = await csvWorld();
  await scopedTarget();
  const response = await get('repoAdmin1', t1.installationId, t1.scoped.documentId);
  expect(response.statusCode).toBe(200);
  expect(parseCsv(response.body)).toHaveLength(1);
  expect(response.body.endsWith('\r\n')).toBe(true);
});

test('the hostile dataset comes out of the route as the file of the service: names guarded, cells whole', async () => {
  const { db, get, t1 } = await csvWorld();
  await db.updateTable('cla_documents').set({ name: HOSTILE_DOCUMENT_NAME }).where('id', '=', t1.documentId).execute();
  await seedSignatures(db, t1, HOSTILE_SEEDS);
  const response = await get('admin1', t1.installationId, t1.documentId);
  const cells = parseCsv(response.body).slice(1).flat();
  expect(cells.filter((cell) => /^[=+\-@\t\r]/.test(cell))).toEqual([]);
  expect(csvRecords(response.body)).toHaveLength(HOSTILE_SEEDS.length + 1);
});

test('the file name never holds what a user wrote: a document named with quotes and line breaks changes nothing, a new day changes the date', async () => {
  const { advance, app, db, get, login, t1 } = await csvWorld();
  await db
    .updateTable('cla_documents')
    .set({ name: 'x"; filename="evil.exe\r\nSet-Cookie: a=b' })
    .where('id', '=', t1.documentId)
    .execute();
  const today = await get('admin1', t1.installationId, t1.documentId);
  expect(today.headers['content-disposition']).toBe(
    `attachment; filename="signatures-${t1.documentId}-2026-11-02.csv"`,
  );
  expect(today.headers['set-cookie']).toBeUndefined();
  advance(60 * 60 * 14);
  const tomorrow = await app.inject({
    method: 'GET',
    url: csvPathOf(t1.installationId, t1.documentId),
    headers: { cookie: (await login(t1.admin.githubId)).cookie },
  });
  expect(tomorrow.headers['content-disposition']).toBe(
    `attachment; filename="signatures-${t1.documentId}-2026-11-03.csv"`,
  );
});

test('a HEAD request is not answered by the export: it has no twin route that would double the budget', async () => {
  const { app, login, t1 } = await csvWorld();
  const admin = await login(t1.admin.githubId);
  const response = await app.inject({
    method: 'HEAD',
    url: csvPathOf(t1.installationId, t1.documentId),
    headers: { cookie: admin.cookie },
  });
  expect(response.statusCode).toBe(404);
});
