// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import { sql } from 'kysely';
import { expect, test, vi } from 'vitest';
import { errorResponseSchema } from '../shared/errors.ts';
import { healthResponseSchema, readyResponseSchema, unavailableResponseSchema } from '../shared/health.ts';
import { createPgDatabase } from './adapters/db/pg.ts';
import { openPgliteDatabase } from './adapters/db/pglite.ts';
import { buildApp } from './app.ts';
import { silentPostgres, testApp, testConfig, UNREACHABLE_DATABASE_URL } from './test-support.ts';

const unreachable = () => createPgDatabase({ connectionString: UNREACHABLE_DATABASE_URL, onError: vi.fn() });

test('GET /healthz answers ok without touching the database', async () => {
  const { app } = await testApp({ db: unreachable() });
  const response = await app.inject('/healthz');
  expect(response.statusCode).toBe(200);
  expect(healthResponseSchema.parse(response.json())).toEqual({ status: 'ok' });
  expect(response.headers['content-type']).toContain('application/json');
});

test('GET /readyz answers ready when the database answers', async () => {
  const { app } = await testApp();
  const response = await app.inject('/readyz');
  expect(response.statusCode).toBe(200);
  expect(readyResponseSchema.parse(response.json())).toEqual({ status: 'ready' });
});

test('GET /readyz answers 503 with a generic body when the database is down', async () => {
  const { app, logs } = await testApp({ db: unreachable() });
  const response = await app.inject('/readyz');
  expect(response.statusCode).toBe(503);
  expect(unavailableResponseSchema.parse(response.json())).toEqual({ status: 'unavailable' });
  expect(response.body).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|user|pw/);
  expect(logs.lines().some((line) => line['msg'] === 'readiness check failed: the database did not answer')).toBe(true);
});

test('GET /readyz answers 503 when the database accepts connections but never answers', async () => {
  const silent = await silentPostgres();
  const db = createPgDatabase({ connectionString: silent.url, onError: vi.fn() });
  const { app } = await testApp({ db, readinessTimeoutMs: 50 });
  const started = Date.now();
  const response = await app.inject('/readyz');
  expect(response.statusCode).toBe(503);
  expect(Date.now() - started).toBeLessThan(2000);
  await silent.close();
});

test('GET /readyz turns 503 as soon as the database goes away', async () => {
  const db = await openPgliteDatabase();
  const { app } = await testApp({ db });
  expect((await app.inject('/readyz')).statusCode).toBe(200);
  await db.destroy();
  expect((await app.inject('/readyz')).statusCode).toBe(503);
});

test('the health routes only answer GET', async () => {
  const { app } = await testApp();
  const response = await app.inject({ method: 'POST', url: '/healthz' });
  expect(response.statusCode).toBe(404);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('not_found');
});

test('closing the app destroys the database', async () => {
  const { app, db } = await testApp();
  await app.close();
  await expect(sql`select 1`.execute(db)).rejects.toThrow('driver has already been destroyed');
});

test('without a logger option the app builds its own from the configuration', async () => {
  const db = await openPgliteDatabase();
  const app = await buildApp({ config: testConfig({ LOG_LEVEL: 'silent' }), db });
  const response = await app.inject('/healthz');
  expect(response.statusCode).toBe(200);
  await app.close();
});
