// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { QueryClient } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { logoutRoute } from '../../shared/auth-contract.ts';
import { App } from '../App.tsx';
import { answer } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { AppRouter } from '../router.tsx';
import { renderWithProviders } from '../test-support/render.tsx';
import { ALICE, CSRF_TOKEN } from '../test-support/session.ts';

// E17-S08: a whole login and logout, driven by MSW through the real app. Nothing about the session reaches the browser's
// storage, the cookie the page can read, the page, the address or the console. The token lives in the query cache only.

const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;

let spies: ReturnType<typeof spyOnConsole>;

function spyOnConsole() {
  return CONSOLE_METHODS.map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  spies = spyOnConsole();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Everything the page printed to the console, as one text. */
function consoleText(): string {
  // type-coverage:ignore-next-line -- the arguments of a console call are any
  return spies.map((spy) => JSON.stringify(spy.mock.calls)).join('\n');
}

function expectNoTraceOfTheSession(): void {
  expect(localStorage).toHaveLength(0);
  expect(sessionStorage).toHaveLength(0);
  expect(document.cookie).toBe('');
  expect(document.documentElement.outerHTML).not.toContain(CSRF_TOKEN);
  expect(window.location.href).not.toContain(CSRF_TOKEN);
  expect(consoleText()).not.toContain(CSRF_TOKEN);
}

test('a visit, a login, a page with the session and a logout leave nothing in storage, cookies, the page, the address or the console', async () => {
  const logout = answer(logoutRoute.path, new Response(null, { status: 204 }));

  // A visitor reads the front page and is offered the login, a plain link the browser follows to GitHub and back.
  const visit = renderWithProviders(<App />);
  const logins = await screen.findAllByRole('link', { name: messages['auth.login'] });
  expect(logins.length).toBeGreaterThan(0);
  expectNoTraceOfTheSession();
  visit.unmount();

  // The login ended: the page is loaded again, now with a session. Its token is in the cache and the page does not show it.
  const loggedIn = renderWithProviders(<App />, { session: ALICE });
  const button = await screen.findByRole('button', { name: messages['auth.logout'] });
  expect(screen.getByText(messages['landing.signedIn'])).toBeInTheDocument();
  expectNoTraceOfTheSession();

  // The person logs out: the token goes with the cache and the front page offers the login again.
  loggedIn.setSession(undefined);
  await loggedIn.user.click(button);
  await screen.findAllByRole('link', { name: messages['auth.login'] });
  expect(logout).toHaveLength(1);
  expect(logout[0]?.headers['x-csrf-token']).toBe(CSRF_TOKEN);
  expectNoTraceOfTheSession();
  expect(window.location.pathname).toBe('/');
});

/** What the query cache holds, as one text. */
function cacheText(queryClient: QueryClient): string {
  return JSON.stringify(
    queryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.state.data),
  );
}

test('the token is in the query cache while the session lasts, and the cache is empty of it after the logout', async () => {
  answer(logoutRoute.path, new Response(null, { status: 204 }));
  const { user, queryClient, setSession } = renderWithProviders(<AppRouter />, { session: ALICE });
  const button = await screen.findByRole('button', { name: messages['auth.logout'] });
  expect(cacheText(queryClient)).toContain(CSRF_TOKEN);
  setSession(undefined);
  await user.click(button);
  await screen.findAllByRole('link', { name: messages['auth.login'] });
  expect(cacheText(queryClient)).not.toContain(CSRF_TOKEN);
});
