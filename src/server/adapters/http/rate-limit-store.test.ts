// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import Fastify, { type FastifyInstance } from 'fastify';
import { expect, test } from 'vitest';
import { registerRateLimit, routeRateLimit } from './rate-limit.ts';

// The store of the rate limit (E10-S08) is in memory and holds at most 10 000 keys, the least recently used one making room
// for the next. The proof is a client that is forgotten: it makes one request, then others fill the store, and it asks
// again. Its remaining budget says whether the store still knew it.

const FIRST_CLIENT = '192.0.2.1';

/** The n-th address of 10.0.0.0/8: n distinct clients, none of them the first one. */
function otherClient(n: number): string {
  return `10.${Math.floor(n / 65_536)}.${Math.floor(n / 256) % 256}.${n % 256}`;
}

async function appWithRoutes(): Promise<FastifyInstance> {
  const app = Fastify();
  await registerRateLimit(app, { trustProxy: false, clock: { now: () => new Date() } });
  app.get('/global', () => 'ok');
  app.get('/own', { config: { rateLimit: routeRateLimit(5) }, exposeHeadRoute: false }, () => 'ok');
  await app.ready();
  return app;
}

/** The remaining budget the client is told on its request to `url`. */
async function remaining(app: FastifyInstance, url: string, remoteAddress: string): Promise<string> {
  const response = await app.inject({ url, remoteAddress });
  return String(response.headers['x-ratelimit-remaining']);
}

/** The first client asks, `others` other clients ask once each, the first client asks again: what it is told the second time. */
async function secondAnswer(url: string, others: number): Promise<string> {
  const app = await appWithRoutes();
  await remaining(app, url, FIRST_CLIENT);
  for (let n = 0; n < others; n++) {
    await app.inject({ url, remoteAddress: otherClient(n) });
  }
  const answer = await remaining(app, url, FIRST_CLIENT);
  await app.close();
  return answer;
}

test.each([
  ['the global store', '/global', '598', '599'],
  ['the store of a route with its own budget', '/own', '3', '4'],
] as const)(
  '%s keeps 10 000 clients and forgets the first one when the 10 001st arrives',
  async (_name, url, kept, forgotten) => {
    expect(await secondAnswer(url, 9_999)).toBe(kept);
    expect(await secondAnswer(url, 10_000)).toBe(forgotten);
  },
  60_000,
);
