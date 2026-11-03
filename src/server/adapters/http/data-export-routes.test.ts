// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { afterEach, expect, test, vi } from 'vitest';
import { DATA_EXPORT_PATH } from '../../../shared/data-export.ts';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { tenantChecksums } from '../db/tenant-fixture/test-support.ts';
import { EXPORTED_AT, exportAuditRows, exportWorld } from './data-export-fixture/test-support.ts';

// `GET /api/me/export` (E16-S06): who may ask, what the query string may carry, what the answer looks like, the budget and the
// audit row. What the document holds is in data-export-content.test.ts, the isolation of people in data-export-tenants.test.ts.

afterEach(() => {
  vi.useRealTimers();
});

const errorCode = (body: unknown): string => errorResponseSchema.parse(body).error.code;

test('a signed-in person downloads their own data: a JSON attachment named after their GitHub id, never cached', async () => {
  const { get, people } = await exportWorld();
  const response = await get('member1');
  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type']).toContain('application/json');
  expect(response.headers['content-disposition']).toBe(
    `attachment; filename="cla-data-${people.member1.githubId}.json"`,
  );
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.json()).toMatchObject({
    schemaVersion: 1,
    exportedAt: EXPORTED_AT,
    user: { githubId: people.member1.githubId, login: `login-${people.member1.githubId}` },
  });
});

test('a request with no session is a 401 and writes no audit row', async () => {
  const { db, get } = await exportWorld();
  const response = await get(null);
  expect(response.statusCode).toBe(401);
  expect(errorCode(response.json())).toBe('unauthorized');
  expect(await exportAuditRows(db)).toEqual([]);
});

test.each(['?githubId=31005', '?userId=1', '?login=login-31005', '?installationId=1', '?limit=1', '?x'])(
  'the query %s is a 400: the subject is the session user and nobody else can be named',
  async (query) => {
    const { db, get } = await exportWorld();
    const before = await tenantChecksums(db);
    const response = await get('member1', query);
    expect(response.statusCode).toBe(400);
    expect(errorCode(response.json())).toBe('bad_request');
    expect(response.body).not.toContain('login-31004');
    expect(await exportAuditRows(db)).toEqual([]);
    expect(await tenantChecksums(db)).toEqual(before);
  },
);

test('an empty query string is no query string', async () => {
  const { get } = await exportWorld();
  expect((await get('member1', '?')).statusCode).toBe(200);
});

test('every person is answered with their own document, whatever the other asks for', async () => {
  const { exported, people } = await exportWorld();
  const first = await exported('member1');
  const second = await exported('admin2');
  expect([first.user.githubId, second.user.githubId]).toEqual([people.member1.githubId, people.admin2.githubId]);
});

test('the route answers GET only: HEAD, POST and the other methods are not served', async () => {
  const { app, ask, db } = await exportWorld();
  const head = await app.inject({ method: 'HEAD', url: DATA_EXPORT_PATH });
  const post = await ask('member1', { method: 'POST', url: DATA_EXPORT_PATH, payload: {} });
  expect([head.statusCode, post.statusCode]).toEqual([404, 404]);
  expect(await exportAuditRows(db)).toEqual([]);
});

test('each export appends one audit row: the person is actor and subject, no installation, the number of signatures', async () => {
  const { db, exported, get, people } = await exportWorld();
  await exported('member1');
  await exported('outsider');
  expect(await exportAuditRows(db)).toEqual([
    {
      installation_id: null,
      actor_github_id: people.member1.githubId,
      subject_type: 'user',
      subject_id: people.member1.githubId,
      metadata: { signature_count: 1 },
    },
    {
      installation_id: null,
      actor_github_id: people.outsider.githubId,
      subject_type: 'user',
      subject_id: people.outsider.githubId,
      metadata: { signature_count: 0 },
    },
  ]);
  const again = await get('member1');
  expect(again.statusCode).toBe(200);
  expect(await exportAuditRows(db)).toHaveLength(3);
});

test('the fifth request of an hour is answered and the sixth is a 429 with retry-after that appends nothing, for that person alone', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-02T10:00:00.000Z'));
  const { db, get } = await exportWorld();
  const statuses: number[] = [];
  for (let request = 0; request < 6; request += 1) {
    statuses.push((await get('member1')).statusCode);
  }
  expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  const refused = await get('member1');
  expect(errorCode(refused.json())).toBe('too_many_requests');
  expect(refused.headers['retry-after']).toBe('3600');
  expect((await get('admin2')).statusCode).toBe(200);
  expect(await exportAuditRows(db)).toHaveLength(6);
});

test('the budget is renewed an hour after the first request, and not before', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-02T10:00:00.000Z'));
  const { get } = await exportWorld();
  for (let request = 0; request < 5; request += 1) {
    expect((await get('member1')).statusCode).toBe(200);
  }
  vi.setSystemTime(new Date('2026-11-02T10:59:59.999Z'));
  expect((await get('member1')).statusCode).toBe(429);
  vi.setSystemTime(new Date('2026-11-02T11:00:00.000Z'));
  expect((await get('member1')).statusCode).toBe(200);
});

test('a request the guard or the validation refuses does not use up the budget of the person who made it', async () => {
  const { get } = await exportWorld();
  for (let request = 0; request < 8; request += 1) {
    expect((await get('member1', '?githubId=1')).statusCode).toBe(400);
    expect((await get(null)).statusCode).toBe(401);
  }
  const statuses: number[] = [];
  for (let request = 0; request < 5; request += 1) {
    statuses.push((await get('member1')).statusCode);
  }
  expect(statuses).toEqual([200, 200, 200, 200, 200]);
  expect((await get('member1')).statusCode).toBe(429);
});
