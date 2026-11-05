// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type * as FastifyModule from 'fastify';
import { expect, test, vi } from 'vitest';
import { AUTH_ENV } from '../../config/auth-fixture/test-support.ts';
import { testApp } from '../../test-support.ts';

// The route table of the real application as it concerns signatures (E15-S03): a signature is revoked once and never changes back.
// The routes are collected by an `onRoute` hook that is added to the Fastify instance the moment it is created, before any route exists.

const seen = vi.hoisted((): string[] => []);

vi.mock('fastify', async (importOriginal) => {
  const actual = await importOriginal<typeof FastifyModule>();
  const create = (options: FastifyModule.FastifyServerOptions) => {
    const app = actual.default(options);
    app.addHook('onRoute', (route) => {
      for (const method of [route.method].flat()) {
        seen.push(`${method.toUpperCase()} ${route.url}`);
      }
    });
    return app;
  };
  return { ...actual, default: create };
});

async function routeTable(): Promise<string[]> {
  seen.length = 0;
  await testApp({ env: AUTH_ENV });
  return [...seen];
}

test('the signature id has no route of its own: no PUT, PATCH or DELETE on /signatures/:signatureId, and no route on it at all', async () => {
  const table = await routeTable();
  expect(table).toContain('POST /api/installations/:installationId/signatures/:signatureId/revoke');
  for (const method of ['PUT', 'PATCH', 'DELETE', 'GET', 'POST']) {
    expect(table).not.toContain(`${method} /api/installations/:installationId/signatures/:signatureId`);
  }
});

test('no route that changes or deletes anything is about a signature, and none is named to undo a revocation', async () => {
  const table = await routeTable();
  const aboutSignatures = table.filter((route) => /signature|revoke/i.test(route));
  expect(aboutSignatures.filter((route) => /^(PUT|PATCH|DELETE) /.test(route))).toEqual([]);
  expect(aboutSignatures.filter((route) => /un-?revoke|restore|reinstate|reactivate/i.test(route))).toEqual([]);
  expect(aboutSignatures.filter((route) => route.includes('/revoke'))).toEqual([
    'POST /api/installations/:installationId/signatures/:signatureId/revoke',
  ]);
});
