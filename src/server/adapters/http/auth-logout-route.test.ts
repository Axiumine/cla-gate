// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type * as FastifyModule from 'fastify';
import { expect, test, vi } from 'vitest';
import { AUTH_ENV } from '../../config/auth-fixture/test-support.ts';
import { testApp } from '../../test-support.ts';
import { auditProblem } from './audit-routes.ts';
import { csrfProblem } from './csrf-routes.ts';

// How the logout route is declared (E10-S06), read from the route table of the real application: collected by an
// `onRoute` hook added to the Fastify instance the moment it is created, before any route exists.

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

async function logoutRoutes(): Promise<SeenRoute[]> {
  seen.length = 0;
  await testApp({ env: AUTH_ENV });
  return seen.filter((route) => route.url === '/api/auth/logout');
}

test('logout is one POST route that declares auditExempt session and no audit action', async () => {
  const routes = await logoutRoutes();
  expect(routes.map((route) => route.method)).toEqual(['POST']);
  const [route] = routes;
  expect(route?.config).toMatchObject({ auditExempt: 'session' });
  expect(route?.config).not.toHaveProperty('audit');
  expect(auditProblem('POST', '/api/auth/logout', route?.config)).toBeUndefined();
});

test('logout is not exempt from the CSRF and Origin check', async () => {
  const [route] = await logoutRoutes();
  expect(route?.config).not.toHaveProperty('csrf');
  expect(csrfProblem('POST', '/api/auth/logout', route?.config)).toBeUndefined();
});

test('the logout route is registered only when the login is configured', async () => {
  seen.length = 0;
  await testApp();
  expect(seen.filter((route) => route.url === '/api/auth/logout')).toEqual([]);
});
