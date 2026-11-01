// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test, vi } from 'vitest';
import { createPgDatabase, createPgPool, typeParser } from './pg.ts';

// Nothing listens on port 1, so these tests exercise the real node-postgres code path without a server.
const UNREACHABLE = 'postgres://user:pw@127.0.0.1:1/db';

test('the pool is lazy: nothing connects until the first query', async () => {
  const db = createPgDatabase({ connectionString: UNREACHABLE, onError: vi.fn() });
  await expect(db.destroy()).resolves.toBeUndefined();
});

test('a query against an unreachable server rejects with the connection error', async () => {
  const db = createPgDatabase({ connectionString: UNREACHABLE, onError: vi.fn() });
  await expect(db.selectFrom('users').selectAll().execute()).rejects.toMatchObject({ code: 'ECONNREFUSED' });
  await db.destroy();
});

test('errors of idle pooled clients go to onError instead of crashing the process', async () => {
  const onError = vi.fn();
  const pool = createPgPool({ connectionString: UNREACHABLE, onError });
  const error = new Error('idle client lost its connection');
  pool.emit('error', error);
  expect(onError).toHaveBeenCalledExactlyOnceWith(error);
  await pool.end();
});

test('bigint (oid 20) is parsed into a number and everything else keeps the pg default', () => {
  expect(typeParser(20)('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER);
  expect(() => typeParser(20)('9007199254740993')).toThrow(RangeError);
  expect(typeParser(25)('text stays text')).toBe('text stays text');
  expect(typeParser(1184)('2026-11-01 10:00:00+00')).toEqual(new Date('2026-11-01T10:00:00Z'));
});

test('the pool uses that parser', async () => {
  const pool = createPgPool({ connectionString: UNREACHABLE, onError: vi.fn() });
  expect(pool.options.types?.getTypeParser).toBe(typeParser);
  await pool.end();
});
