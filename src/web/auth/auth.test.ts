// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { QueryClient } from '@tanstack/react-query';
import { expect, test, vi } from 'vitest';
import { sessionResponseSchema } from '../../shared/auth.ts';
import { logoutRoute, sessionRoute } from '../../shared/auth-contract.ts';
import { createQueryClient } from '../api/index.ts';
import { answer, envelope, json, listThings, rejection } from '../api/test-support.ts';
import { ALICE, CSRF_TOKEN } from '../test-support/session.ts';
import { authFor } from './auth.ts';
import { ANONYMOUS, SESSION_KEY, type Session } from './session.ts';

// E17-S08: the auth layer of one query cache: the client that sends what E10 requires, and what happens when a call says
// the session is over.

const FRESH_TOKEN = `${'fr3sh'.repeat(8)}abc`;
const LOGGED_IN: Session = {
  authenticated: true,
  user: { githubId: 4711, login: 'octocat', name: null, avatarUrl: null },
  csrfToken: CSRF_TOKEN,
  expiresAt: '2026-11-02T10:00:00.000Z',
};

/** A cache that already holds a session, as it does once the app has asked the server. */
function loggedInClient(): QueryClient {
  const queryClient = createQueryClient();
  queryClient.setQueryData(SESSION_KEY, LOGGED_IN);
  return queryClient;
}

test('a query client has one auth layer, and another query client has its own', () => {
  const first = createQueryClient();
  expect(authFor(first)).toBe(authFor(first));
  expect(authFor(createQueryClient())).not.toBe(authFor(first));
});

test('a call that changes state carries the CSRF token of the session held in the cache, in x-csrf-token and nowhere else', async () => {
  const seen = answer(logoutRoute.path, new Response(null, { status: 204 }));
  await authFor(loggedInClient()).client.call(logoutRoute);
  expect(seen).toHaveLength(1);
  expect(seen[0]?.headers['x-csrf-token']).toBe(CSRF_TOKEN);
  expect(seen[0]?.headers['authorization']).toBeUndefined();
  expect(seen[0]?.headers['cookie']).toBeUndefined();
  expect(seen[0]?.url).not.toContain(CSRF_TOKEN);
});

test('a call that only reads carries no CSRF token', async () => {
  const seen = answer(listThings.path, json([]));
  await authFor(loggedInClient()).client.call(listThings);
  expect(seen[0]?.headers['x-csrf-token']).toBeUndefined();
});

test('without a session in the cache a call that changes state carries no token', async () => {
  const seen = answer(logoutRoute.path, new Response(null, { status: 204 }));
  await authFor(createQueryClient()).client.call(logoutRoute);
  expect(seen[0]?.headers['x-csrf-token']).toBeUndefined();
});

test('when the server rejects the token, the session is asked for again and the call is repeated once with the new token', async () => {
  const queryClient = loggedInClient();
  const seen = answer(logoutRoute.path, envelope(403, 'csrf_invalid'), new Response(null, { status: 204 }));
  const session = answer(sessionRoute.path, json(sessionResponseSchema.parse({ ...ALICE, csrfToken: FRESH_TOKEN })));
  await authFor(queryClient).client.call(logoutRoute);
  expect(session).toHaveLength(1);
  expect(seen.map((request) => request.headers['x-csrf-token'])).toEqual([CSRF_TOKEN, FRESH_TOKEN]);
  expect(queryClient.getQueryData<Session>(SESSION_KEY)).toMatchObject({ authenticated: true, csrfToken: FRESH_TOKEN });
});

test.each([
  ['no session any more', () => envelope(401, 'unauthorized')],
  ['an error from the server', () => envelope(500, 'internal_server_error')],
  ['a dropped connection', () => Response.error()],
])(
  'when the token is rejected and the session is asked for again but the answer is %s, the first refusal is the result',
  async (_what, answerSession) => {
    const seen = answer(logoutRoute.path, envelope(403, 'csrf_invalid'));
    answer(sessionRoute.path, answerSession());
    const error = await rejection(authFor(loggedInClient()).client.call(logoutRoute));
    expect(error).toMatchObject({ status: 403, code: 'csrf_invalid' });
    expect(seen).toHaveLength(1);
  },
);

test('with nobody logged in, a rejected token is looked up again, the server says "nobody", and the first refusal is the result', async () => {
  const seen = answer(logoutRoute.path, envelope(403, 'csrf_invalid'));
  const session = answer(sessionRoute.path, envelope(401, 'unauthorized'));
  const auth = authFor(createQueryClient());
  expect(await rejection(auth.client.call(logoutRoute))).toMatchObject({ status: 403, code: 'csrf_invalid' });
  expect(session).toHaveLength(1);
  expect(seen).toHaveLength(1);
  expect(auth.getState()).toEqual({ ended: false, epoch: 0 });
});

test('a 401 while a session is held ends it: the cache is cleared, nobody is logged in and the session is marked out of date', async () => {
  const queryClient = loggedInClient();
  queryClient.setQueryData(['repositories', 42], ['one', 'two']);
  const clear = vi.spyOn(queryClient, 'clear');
  answer(listThings.path, envelope(401, 'unauthorized'));
  const auth = authFor(queryClient);
  expect(await rejection(auth.client.call(listThings))).toMatchObject({ status: 401, code: 'unauthenticated' });
  expect(clear).toHaveBeenCalledOnce();
  expect(queryClient.getQueryData(['repositories', 42])).toBeUndefined();
  expect(queryClient.getQueryData(SESSION_KEY)).toEqual(ANONYMOUS);
  expect(queryClient.getQueryState(SESSION_KEY)?.isInvalidated).toBe(true);
  expect(auth.getState()).toEqual({ ended: true, epoch: 1 });
});

test('a 401 with nobody logged in is the plain answer "log in first": nothing is cleared and nothing ended', async () => {
  const queryClient = createQueryClient();
  queryClient.setQueryData(SESSION_KEY, ANONYMOUS);
  queryClient.setQueryData(['public-page'], 'kept');
  answer(listThings.path, envelope(401, 'unauthorized'));
  const auth = authFor(queryClient);
  await rejection(auth.client.call(listThings));
  expect(queryClient.getQueryData(['public-page'])).toBe('kept');
  expect(auth.getState()).toEqual({ ended: false, epoch: 0 });
});

test('a 401 before the session was ever loaded ends nothing either', async () => {
  const queryClient = createQueryClient();
  answer(listThings.path, envelope(401, 'unauthorized'));
  const auth = authFor(queryClient);
  await rejection(auth.client.call(listThings));
  expect(auth.getState()).toEqual({ ended: false, epoch: 0 });
});

test('the session endpoint answering 401 to a session that was held ends it too', async () => {
  const queryClient = loggedInClient();
  answer(sessionRoute.path, envelope(401, 'unauthorized'));
  const auth = authFor(queryClient);
  expect(await rejection(auth.client.call(sessionRoute))).toMatchObject({ status: 401 });
  expect(auth.getState()).toEqual({ ended: true, epoch: 1 });
  expect(queryClient.getQueryData(SESSION_KEY)).toEqual(ANONYMOUS);
});

test('an error that is not a 401 leaves the session alone', async () => {
  const queryClient = loggedInClient();
  answer(listThings.path, envelope(403, 'forbidden'));
  const auth = authFor(queryClient);
  await rejection(auth.client.call(listThings));
  expect(queryClient.getQueryData(SESSION_KEY)).toEqual(LOGGED_IN);
  expect(auth.getState()).toEqual({ ended: false, epoch: 0 });
});

test('signing out clears the cache and leaves nobody logged in, without calling the session an ended one', () => {
  const queryClient = loggedInClient();
  queryClient.setQueryData(['repositories', 42], ['one']);
  const clear = vi.spyOn(queryClient, 'clear');
  const auth = authFor(queryClient);
  auth.signedOut();
  expect(clear).toHaveBeenCalledOnce();
  expect(queryClient.getQueryData(['repositories', 42])).toBeUndefined();
  expect(queryClient.getQueryData(SESSION_KEY)).toEqual(ANONYMOUS);
  expect(queryClient.getQueryState(SESSION_KEY)?.isInvalidated).toBe(false);
  expect(auth.getState()).toEqual({ ended: false, epoch: 1 });
});

test('a listener is told when the state changes and not after it unsubscribes', () => {
  const auth = authFor(loggedInClient());
  const listener = vi.fn();
  const unsubscribe = auth.subscribe(listener);
  auth.signedOut();
  expect(listener).toHaveBeenCalledOnce();
  unsubscribe();
  auth.signedOut();
  expect(listener).toHaveBeenCalledOnce();
  expect(auth.getState().epoch).toBe(2);
});

test('the layer is made of the query client alone: a plain QueryClient works as well as the app one', () => {
  expect(authFor(new QueryClient()).getState()).toEqual({ ended: false, epoch: 0 });
});
