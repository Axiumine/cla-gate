// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { afterEach, expect, test, vi } from 'vitest';
import { RATE_LIMITS } from './rate-limit.ts';
import { errorCodeOf, searchWorld } from './signature-search-fixture/test-support.ts';

// The budget of the signature search (E15-S02): it shows the personal data of up to 100 signers a page and writes no audit row, so each
// person has a budget of their own, as the export has, counted after the guard of the route and not shared with anybody else. The query
// is read in the handler, after the guard (so a stranger learns nothing of how it is read), hence a malformed query of a person who
// passed the guard is counted.

afterEach(() => {
  vi.useRealTimers();
});

const BUDGET = RATE_LIMITS.signatureSearch;

test('the thirty-first search of a minute is a 429 with retry-after that costs nobody else a request, and the budget is renewed a minute after the first', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-02T10:00:00.000Z'));
  const { search, t1 } = await searchWorld();
  const statuses: number[] = [];
  for (let request = 0; request < BUDGET; request += 1) {
    statuses.push((await search('admin1', t1.installationId)).statusCode);
  }
  expect(statuses).toEqual(Array.from({ length: BUDGET }, () => 200));
  const refused = await search('admin1', t1.installationId);
  expect(refused.statusCode).toBe(429);
  expect(errorCodeOf(refused)).toBe('too_many_requests');
  expect(refused.headers['retry-after']).toBe('60');
  expect((await search('repoAdmin1', t1.installationId)).statusCode).toBe(200);
  vi.setSystemTime(new Date('2026-11-02T10:00:59.999Z'));
  expect((await search('admin1', t1.installationId)).statusCode).toBe(429);
  vi.setSystemTime(new Date('2026-11-02T10:01:00.000Z'));
  expect((await search('admin1', t1.installationId)).statusCode).toBe(200);
});

test('a request the guard refuses does not use up the budget of the person who made it', async () => {
  const { search, t1, t2 } = await searchWorld();
  for (let request = 0; request < BUDGET + 2; request += 1) {
    expect((await search('admin1', t2.installationId)).statusCode).toBe(404);
    expect((await search(null, t1.installationId)).statusCode).toBe(401);
  }
  const statuses: number[] = [];
  for (let request = 0; request < BUDGET; request += 1) {
    statuses.push((await search('admin1', t1.installationId)).statusCode);
  }
  expect(statuses).toEqual(Array.from({ length: BUDGET }, () => 200));
  expect((await search('admin1', t1.installationId)).statusCode).toBe(429);
});
