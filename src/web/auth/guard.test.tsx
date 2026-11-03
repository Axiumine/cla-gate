// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen } from '@testing-library/react';
import { delay, HttpResponse, http } from 'msw';
import { afterEach, expect, test, vi } from 'vitest';
import { sessionRoute } from '../../shared/auth-contract.ts';
import { createQueryClient } from '../api/index.ts';
import { messages } from '../i18n/index.ts';
import { TestAppRoutes } from '../test-support/app-routes.tsx';
import { spyOnPageNavigation } from '../test-support/location.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { server } from '../test-support/server.ts';
import { ALICE } from '../test-support/session.ts';
import { requireSession } from './guard.ts';
import { SESSION_KEY, type Session } from './session.ts';

// E17-S08: an unauthenticated visitor of an `authenticated` route is sent to the login start by a full-page navigation, with
// return_to set to the page they asked for.

const pages = [
  { path: '/members', access: 'authenticated', component: () => <p>the members page</p> },
  { path: '/open', access: 'public', component: () => <p>the open page</p> },
] as const;

const LOGGED_IN: Session = {
  authenticated: true,
  user: { githubId: 4711, login: 'octocat', name: null, avatarUrl: null },
  csrfToken: 'x'.repeat(43),
  expiresAt: '2026-11-02T10:00:00.000Z',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

test('a visitor without a session is sent to the login start by a full-page navigation with return_to set to the path and the search', async () => {
  const assign = spyOnPageNavigation();
  renderWithProviders(<TestAppRoutes route="/members?tab=2&sort=name" pages={pages} />);
  await vi.waitFor(() => {
    expect(assign).toHaveBeenCalledExactlyOnceWith('/api/auth/login?return_to=%2Fmembers%3Ftab%3D2%26sort%3Dname');
  });
  expect(screen.queryByText('the members page')).toBeNull();
});

test('the fragment of the address is not part of return_to', async () => {
  const assign = spyOnPageNavigation();
  renderWithProviders(<TestAppRoutes route="/members?tab=2#top" pages={pages} />);
  await vi.waitFor(() => {
    expect(assign).toHaveBeenCalledExactlyOnceWith('/api/auth/login?return_to=%2Fmembers%3Ftab%3D2');
  });
});

test('the screen is never rendered for the visitor, not even for a moment, and no error is shown while the page is leaving', async () => {
  spyOnPageNavigation();
  renderWithProviders(<TestAppRoutes route="/members" pages={pages} />);
  await delay(50);
  expect(screen.queryByText('the members page')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

test('a visitor with a session sees the page and is not sent anywhere', async () => {
  const assign = spyOnPageNavigation();
  renderWithProviders(<TestAppRoutes route="/members" pages={pages} />, { session: ALICE });
  expect(await screen.findByText('the members page')).toBeInTheDocument();
  expect(assign).not.toHaveBeenCalled();
});

test('a public route is shown to a visitor without a session, who is not sent anywhere', async () => {
  const assign = spyOnPageNavigation();
  renderWithProviders(<TestAppRoutes route="/open" pages={pages} />);
  expect(await screen.findByText('the open page')).toBeInTheDocument();
  expect(assign).not.toHaveBeenCalled();
});

test('the guard and the user menu share one request for the session', async () => {
  spyOnPageNavigation();
  const { sessionRequests } = renderWithProviders(<TestAppRoutes route="/members" pages={pages} />, { session: ALICE });
  await screen.findByText('the members page');
  expect(sessionRequests).toHaveLength(1);
});

test('when the server cannot say who is logged in the route shows its error and the visitor is not sent to the login', async () => {
  const assign = spyOnPageNavigation();
  renderWithProviders(<TestAppRoutes route="/members" pages={pages} />);
  server.use(
    http.get(sessionRoute.path, () =>
      HttpResponse.json(
        { error: { code: 'internal_server_error', message: 'x', requestId: 'req-1' } },
        { status: 500 },
      ),
    ),
  );
  expect(await screen.findByRole('heading', { level: 1, name: messages['states.error.title'] })).toBeInTheDocument();
  expect(assign).not.toHaveBeenCalled();
});

test('the guard on its own: a session lets it resolve, no session sends the page away and it never settles', async () => {
  const assign = spyOnPageNavigation();
  const location = { pathname: '/members', searchStr: '' };
  const withSession = createQueryClient();
  withSession.setQueryData(SESSION_KEY, LOGGED_IN);
  await expect(requireSession({ context: { queryClient: withSession }, location })).resolves.toBeUndefined();
  expect(assign).not.toHaveBeenCalled();

  server.use(http.get(sessionRoute.path, () => HttpResponse.json({}, { status: 401 })));
  const settled = vi.fn();
  void requireSession({ context: { queryClient: createQueryClient() }, location }).then(settled);
  await vi.waitFor(() => {
    expect(assign).toHaveBeenCalledExactlyOnceWith('/api/auth/login?return_to=%2Fmembers');
  });
  await delay(30);
  expect(settled).not.toHaveBeenCalled();
});
