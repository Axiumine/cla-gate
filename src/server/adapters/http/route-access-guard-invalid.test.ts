// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import Fastify from 'fastify';
import { expect, onTestFinished, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { parseGithubId } from '../../../shared/github-id.ts';
import { createOperatorPolicies } from '../../services/operator-policies.ts';
import { openPgliteDatabase } from '../db/pglite.ts';
import { registerErrorHandlers } from './errors.ts';
import { guardRouteAccess } from './route-access-guard.ts';

// A route whose access declaration is missing or not valid (E11-S01, E11-S08). An application with such a route does not
// become ready (route-access.test.ts), so no request should ever meet one; the guard still treats it as the route that
// does not exist for everybody, so the check at start-up is not the only thing between such a route and a caller.

async function bareApp() {
  const app = Fastify();
  registerErrorHandlers(app);
  app.decorateRequest('auth', null);
  app.decorateRequest('sessionCookiePresented', false);
  const githubId = parseGithubId(42);
  app.addHook('onRequest', (request, _reply, done) => {
    request.auth = {
      user: { id: 1, githubId, login: 'login-42', name: null, avatarUrl: null },
      sessionId: 1,
      csrfSecret: 'a-made-up-session-secret',
      expiresAt: new Date('2030-01-01T00:00:00Z'),
    };
    done();
  });
  const db = await openPgliteDatabase();
  onTestFinished(async () => {
    await db.destroy();
  });
  guardRouteAccess(app, {
    db,
    authorize: () => Promise.reject(new Error('the tenant guard is not under test')),
    // The caller is an operator, so a route that was let through as an operator route would answer.
    operators: createOperatorPolicies({ configured: [githubId], owner: undefined, logger: { info: () => undefined } }),
  });
  return app;
}

test('a route that declares no access is the 404 of a route that does not exist, for a caller who is the operator, and its handler does not run', async () => {
  const app = await bareApp();
  const reached: string[] = [];
  app.get('/undeclared', () => {
    reached.push('undeclared');
    return 'x';
  });
  app.get('/operator', { config: { access: 'operator' } }, () => {
    reached.push('operator');
    return 'x';
  });
  const response = await app.inject('/undeclared');
  expect(response.statusCode).toBe(404);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('not_found');
  expect(reached).toEqual([]);
  expect((await app.inject('/operator')).statusCode).toBe(200);
  expect(reached).toEqual(['operator']);
});
