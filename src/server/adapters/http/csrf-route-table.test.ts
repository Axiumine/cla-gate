// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type * as FastifyModule from 'fastify';
import { expect, test, vi } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { AUTH_ENV } from '../../config/auth-fixture/test-support.ts';
import { testApp } from '../../test-support.ts';
import { CSRF_EXEMPT, csrfProblem } from './csrf-routes.ts';

// The route table of the real application (E10-S03): every route that is registered while the app is built, collected by
// an `onRoute` hook that is added to the Fastify instance the moment it is created, before any route exists.

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

type MutatingMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

function isMutating(method: string): method is MutatingMethod {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
}

function methodsOf(route: SeenRoute): string[] {
  return [route.method].flat().map((method) => method.toUpperCase());
}

function names(route: SeenRoute): string[] {
  return methodsOf(route).map((method) => `${method} ${route.url}`);
}

function flaggedExempt(route: SeenRoute): boolean {
  const { config } = route;
  return typeof config === 'object' && config !== null && 'csrf' in config && config.csrf === 'exempt';
}

test('the table is collected: the application registers its routes with the login configured', async () => {
  seen.length = 0;
  await testApp({ env: AUTH_ENV });
  const all = seen.flatMap(names);
  expect(all).toContain('GET /api/auth/session');
  expect(all).toContain('GET /healthz');
});

// The webhook route (E06-S01) is in the table, so the flagged routes are exactly the list.
test('every route of the table that sets config.csrf is on the CSRF_EXEMPT list, and the list is all of them', async () => {
  seen.length = 0;
  await testApp({ env: AUTH_ENV });
  const flagged = seen.filter(flaggedExempt).flatMap(names);
  expect(flagged).toEqual(CSRF_EXEMPT);
  expect(seen.flatMap((route) => csrfProblem(route.method, route.url, route.config) ?? [])).toEqual([]);
});

test('every state-changing route of the table, a canary added here included, is exempt by list or refuses a request with no Origin', async () => {
  seen.length = 0;
  const { app } = await testApp({ env: AUTH_ENV });
  app.post('/canary', () => 'reached');
  const checked: string[] = [];
  for (const route of seen) {
    for (const method of methodsOf(route).filter(isMutating)) {
      if (!CSRF_EXEMPT.includes(`${method} ${route.url}`)) {
        const response = await app.inject({ method, url: route.url });
        expect(errorResponseSchema.parse(response.json()).error.code).toBe('origin_not_allowed');
        checked.push(`${method} ${route.url}`);
      }
    }
  }
  expect(checked).toContain('POST /canary');
});
