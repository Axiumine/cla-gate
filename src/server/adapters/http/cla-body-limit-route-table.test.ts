// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type * as FastifyModule from 'fastify';
import { expect, test, vi } from 'vitest';
import { DOCUMENTS_PATH } from '../../../shared/cla.ts';
import { AUTH_ENV } from '../../config/auth-fixture/test-support.ts';
import { testApp } from '../../test-support.ts';
import { CLA_BODY_LIMIT } from './limits.ts';

// The route table of the real application (E12-S02): every route registered while the app is built, collected by an
// `onRoute` hook that is added to the Fastify instance the moment it is created, before any route exists. Every route of
// the CLA documents that changes data sets the body limit of 512 KiB, so a draft or a version added by a later story of the
// epic cannot take the 1 MiB of the other routes by leaving the option out. A `DELETE` reads no body, but Fastify would parse
// one of 1 MiB, so it sets the limit too (E12-S03).

interface SeenRoute {
  readonly method: string | readonly string[];
  readonly url: string;
  readonly bodyLimit: number | undefined;
}

const seen = vi.hoisted((): SeenRoute[] => []);

vi.mock('fastify', async (importOriginal) => {
  const actual = await importOriginal<typeof FastifyModule>();
  const create = (options: FastifyModule.FastifyServerOptions) => {
    const app = actual.default(options);
    app.addHook('onRoute', (route) => {
      seen.push({ method: route.method, url: route.url, bodyLimit: route.bodyLimit });
    });
    return app;
  };
  return { ...actual, default: create };
});

const BODY_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

function claRoutesThatReadABody(table: readonly SeenRoute[]): (readonly [name: string, bodyLimit: unknown])[] {
  return table
    .filter((route) => route.url.startsWith(DOCUMENTS_PATH))
    .flatMap((route) =>
      [route.method]
        .flat()
        .map((method) => method.toUpperCase())
        .filter((method) => BODY_METHODS.includes(method))
        .map((method) => [`${method} ${route.url}`, route.bodyLimit] as const),
    );
}

test('every route of the CLA documents that reads a body, those of later stories included, sets the body limit of 512 KiB', async () => {
  seen.length = 0;
  await testApp({ env: AUTH_ENV });
  const routes = claRoutesThatReadABody(seen);
  expect(routes.map(([name]) => name)).toEqual(
    expect.arrayContaining([
      'PATCH /api/installations/:installationId/documents/:documentId',
      'POST /api/installations/:installationId/documents',
      'PUT /api/installations/:installationId/documents/:documentId/draft',
      'DELETE /api/installations/:installationId/documents/:documentId/draft',
      'POST /api/installations/:installationId/documents/:documentId/versions',
    ]),
  );
  expect(routes.filter(([, limit]) => limit !== CLA_BODY_LIMIT)).toEqual([]);
});
