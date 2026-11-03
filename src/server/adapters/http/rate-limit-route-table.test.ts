// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type * as FastifyModule from 'fastify';
import { expect, test, vi } from 'vitest';
import { DATA_EXPORT_PATH } from '../../../shared/data-export.ts';
import { SIGNATURES_CSV_PATH } from '../../../shared/signature-export.ts';
import { AUTH_ENV } from '../../config/auth-fixture/test-support.ts';
import { testApp } from '../../test-support.ts';
import { RATE_LIMIT_EXEMPT, rateLimitProblem } from './rate-limit.ts';

// The route table of the real application (E10-S08): every route registered while the app is built, collected by an
// `onRoute` hook that is added to the Fastify instance the moment it is created, before any route exists. It shows which
// routes leave the global budget, and which have a budget of their own.

interface SeenRoute {
  readonly method: string | readonly string[];
  readonly url: string;
  readonly config: unknown;
}

const seen = vi.hoisted((): SeenRoute[] => []);

vi.mock('fastify', async (importOriginal) => {
  const actual = await importOriginal<typeof FastifyModule>();
  const create = (options: FastifyModule.FastifyServerOptions) => {
    const app = actual.default(options);
    app.addHook('onRoute', (route) => {
      seen.push({ method: route.method, url: route.url, config: route.config });
    });
    return app;
  };
  return { ...actual, default: create };
});

function names(route: SeenRoute): string[] {
  return [route.method].flat().map((method) => `${method.toUpperCase()} ${route.url}`);
}

function limitOf(route: SeenRoute): unknown {
  const { config } = route;
  return typeof config === 'object' && config !== null && 'rateLimit' in config ? config.rateLimit : undefined;
}

async function tableOfTheApp(): Promise<SeenRoute[]> {
  seen.length = 0;
  await testApp({ env: AUTH_ENV });
  return [...seen];
}

test('the table is collected: the application registers its routes with the login configured', async () => {
  const table = await tableOfTheApp();
  expect(table.flatMap(names)).toContain('GET /api/auth/session');
  expect(table.flatMap(names)).toContain('GET /healthz');
});

// The webhook route (E06-S01) is in the table, so the routes switched off are exactly the list.
test('every route of the table that switches the limit off is on the RATE_LIMIT_EXEMPT list, and the list is all of them', async () => {
  const table = await tableOfTheApp();
  const off = table.filter((route) => limitOf(route) === false).flatMap(names);
  expect(off).toEqual(RATE_LIMIT_EXEMPT);
  expect(table.flatMap((route) => rateLimitProblem(route.method, route.url, route.config) ?? [])).toEqual([]);
});

/** `expect.any` is typed `any`; as `unknown` it can sit in an object literal. */
const anyFunction: unknown = expect.any(Function);

test('the routes with a budget of their own are the four of the login, the save of a draft, the signature CSV and the export of the own data, each with the key cap, and none answers HEAD', async () => {
  const table = await tableOfTheApp();
  const own = table.filter((route) => typeof limitOf(route) === 'object');
  const budgets = Object.fromEntries(own.flatMap((route) => names(route).map((name) => [name, limitOf(route)])));
  const csv = `GET ${SIGNATURES_CSV_PATH}`;
  const mine = `GET ${DATA_EXPORT_PATH}`;
  expect(Object.keys(budgets).toSorted((a, b) => a.localeCompare(b))).toEqual(
    [
      'GET /api/auth/callback',
      'GET /api/auth/login',
      'GET /api/auth/session',
      'POST /api/auth/logout',
      'PUT /api/installations/:installationId/documents/:documentId/draft',
      csv,
      mine,
    ].toSorted((a, b) => a.localeCompare(b)),
  );
  expect(Object.fromEntries(Object.entries(budgets).filter(([name]) => name !== csv && name !== mine))).toEqual({
    'GET /api/auth/login': { max: 20, timeWindow: 60_000, cache: 10_000 },
    'GET /api/auth/callback': { max: 20, timeWindow: 60_000, cache: 10_000 },
    'POST /api/auth/logout': { max: 20, timeWindow: 60_000, cache: 10_000 },
    'GET /api/auth/session': { max: 120, timeWindow: 60_000, cache: 10_000 },
    // E12-S03: 30 saves a minute for each person, counted after the guard (hook preHandler) and keyed on the person.
    'PUT /api/installations/:installationId/documents/:documentId/draft': {
      max: 30,
      timeWindow: 60_000,
      cache: 10_000,
      hook: 'preHandler',
      keyGenerator: anyFunction,
    },
  });
  // The exports key their budget on the person and check it after the guard of the route access (E16-S03, E16-S06).
  expect(Object.entries(budgets)).toContainEqual([
    csv,
    expect.objectContaining({ max: 6, timeWindow: 60_000, cache: 10_000, hook: 'preHandler' }),
  ]);
  expect(Object.entries(budgets)).toContainEqual([
    mine,
    expect.objectContaining({ max: 5, timeWindow: 3_600_000, cache: 10_000, hook: 'preHandler' }),
  ]);
  expect(own.flatMap((route) => names(route)).filter((name) => name.startsWith('HEAD '))).toEqual([]);
});
