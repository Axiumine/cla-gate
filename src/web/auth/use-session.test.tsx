// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { focusManager } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import { delay, HttpResponse, http } from 'msw';
import { afterEach, expect, test, vi } from 'vitest';
import { sessionRoute } from '../../shared/auth-contract.ts';
import { ApiError, ContractError, createQueryClient, NetworkError } from '../api/index.ts';
import { expectNoTokenInTheBrowser } from '../test-support/no-trace.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { server } from '../test-support/server.ts';
import { ALICE, CSRF_TOKEN } from '../test-support/session.ts';
import { authFor } from './auth.ts';
import { useSession } from './hooks.ts';
import { SESSION_KEY, sessionQueryOptions } from './session.ts';

// E17-S08: useSession asks the current-session endpoint through the typed client and holds the answer in the query cache.

function WhoAmI() {
  const query = useSession();
  if (query.isError) {
    return <p>failed</p>;
  }
  const session = query.data;
  if (session === undefined) {
    return <p>loading</p>;
  }
  return <p>{session.authenticated ? `logged in as ${session.user.login}` : 'nobody'}</p>;
}

afterEach(() => {
  vi.useRealTimers();
  focusManager.setFocused();
});

test('a logged-in visitor is the user (numeric GitHub id, login, name, avatar) plus the CSRF token and the end of the session', async () => {
  const { queryClient } = renderWithProviders(<WhoAmI />, { session: ALICE });
  expect(await screen.findByText('logged in as octocat')).toBeInTheDocument();
  expect(queryClient.getQueryData(SESSION_KEY)).toEqual({
    authenticated: true,
    user: {
      githubId: 4711,
      login: 'octocat',
      name: 'The Octocat',
      avatarUrl: 'https://avatars.githubusercontent.com/u/4711?v=4',
    },
    csrfToken: CSRF_TOKEN,
    expiresAt: '2026-11-02T10:00:00.000Z',
  });
});

test('the numeric GitHub id is a number, which is what identity is keyed on', async () => {
  const { queryClient } = renderWithProviders(<WhoAmI />, { session: ALICE });
  await screen.findByText('logged in as octocat');
  const held = queryClient.getQueryData<{ user: { githubId: unknown } }>(SESSION_KEY);
  expect(typeof held?.user.githubId).toBe('number');
});

test('a visitor without a session is { authenticated: false }: the 401 is the answer, not an error', async () => {
  const { queryClient } = renderWithProviders(<WhoAmI />);
  expect(await screen.findByText('nobody')).toBeInTheDocument();
  expect(queryClient.getQueryData(SESSION_KEY)).toEqual({ authenticated: false });
  expect(queryClient.getQueryState(SESSION_KEY)?.status).toBe('success');
});

test.each([
  ['a look-alike host', 'https://avatars.githubusercontent.com.evil.example/u/1'],
  ['a script address', 'javascript:alert(1)'],
  ['plain HTTP', 'https://avatars.githubusercontent.com/u/1'.replace('https:', 'http:')],
])('an avatar on %s is dropped, and the rest of the session is kept', async (_what, avatarUrl) => {
  const { queryClient } = renderWithProviders(<WhoAmI />, {
    session: { ...ALICE, user: { ...ALICE.user, avatarUrl } },
  });
  await screen.findByText('logged in as octocat');
  expect(queryClient.getQueryData(SESSION_KEY)).toMatchObject({
    authenticated: true,
    user: { login: 'octocat', avatarUrl: null },
    csrfToken: CSRF_TOKEN,
  });
});

test('the request is a plain GET for JSON from this origin with the cookie and no Authorization header', async () => {
  const { sessionRequests } = renderWithProviders(<WhoAmI />, { session: ALICE });
  await screen.findByText('logged in as octocat');
  const request = sessionRequests[0];
  expect(request?.method).toBe('GET');
  expect(request?.headers.get('accept')).toBe('application/json');
  expect(request?.headers.has('authorization')).toBe(false);
  expect(request?.headers.has('x-csrf-token')).toBe(false);
  expect(request?.credentials).toBe('same-origin');
});

test.each([
  [
    'a server error',
    () =>
      HttpResponse.json(
        { error: { code: 'internal_server_error', message: 'x', requestId: 'req-1' } },
        { status: 500 },
      ),
    ApiError,
  ],
  ['a body of the wrong shape', () => HttpResponse.json({ user: 'nobody' }), ContractError],
  ['a dropped connection', () => HttpResponse.error(), NetworkError],
])('%s is the error of the query, with no session', async (_what, answer, kind) => {
  const { queryClient } = renderWithProviders(<WhoAmI />);
  server.use(http.get(sessionRoute.path, answer));
  expect(await screen.findByText('failed')).toBeInTheDocument();
  expect(queryClient.getQueryData(SESSION_KEY)).toBeUndefined();
  expect(queryClient.getQueryState(SESSION_KEY)?.error).toBeInstanceOf(kind);
});

test('two components that read the session share one request', async () => {
  const { sessionRequests } = renderWithProviders(
    <>
      <WhoAmI />
      <WhoAmI />
    </>,
    { session: ALICE },
  );
  expect(await screen.findAllByText('logged in as octocat')).toHaveLength(2);
  expect(sessionRequests).toHaveLength(1);
});

test('the session is fresh for 60 seconds: coming back to the window within a minute asks nothing', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const { sessionRequests } = renderWithProviders(<WhoAmI />, { session: ALICE });
  await screen.findByText('logged in as octocat');
  vi.setSystemTime(Date.now() + 59_000);
  focusManager.setFocused(true);
  await delay(20);
  expect(sessionRequests).toHaveLength(1);
});

test('after 60 seconds, coming back to the window asks again, and what the server says now replaces the session', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const { sessionRequests, setSession, queryClient } = renderWithProviders(<WhoAmI />, { session: ALICE });
  await screen.findByText('logged in as octocat');
  vi.setSystemTime(Date.now() + 61_000);
  setSession({ ...ALICE, user: { ...ALICE.user, login: 'monalisa' } });
  focusManager.setFocused(true);
  expect(await screen.findByText('logged in as monalisa')).toBeInTheDocument();
  expect(sessionRequests).toHaveLength(2);
  expect(queryClient.getQueryState(SESSION_KEY)?.dataUpdateCount).toBe(2);
});

test('the token is held in the query cache and nowhere else: nothing in Web Storage, no cookie, nothing on the page', async () => {
  renderWithProviders(<WhoAmI />, { session: ALICE });
  await waitFor(() => {
    expect(screen.getByText('logged in as octocat')).toBeInTheDocument();
  });
  expectNoTokenInTheBrowser();
});

test('the query is configured for 60 seconds of freshness and a new look when the window gets focus', () => {
  const options = sessionQueryOptions(authFor(createQueryClient()).client);
  expect(options.staleTime).toBe(60_000);
  expect(options.refetchOnWindowFocus).toBe(true);
  expect(options.queryKey).toEqual(['auth', 'session']);
});
