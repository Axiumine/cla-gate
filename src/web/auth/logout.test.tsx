// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor } from '@testing-library/react';
import { delay, HttpResponse, http } from 'msw';
import { expect, test, vi } from 'vitest';
import { logoutRoute } from '../../shared/auth-contract.ts';
import { ContractError } from '../api/index.ts';
import { answer, envelope, rejection } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { AppRouter } from '../router.tsx';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { TestAppRoutes } from '../test-support/app-routes.tsx';
import { renderWithProviders } from '../test-support/render.tsx';
import { server } from '../test-support/server.ts';
import { ALICE, CSRF_TOKEN } from '../test-support/session.ts';
import { authFor } from './auth.ts';
import { SESSION_KEY } from './session.ts';
import { useLogout } from './use-logout.ts';

// E17-S08: "Log out" posts to E10's logout through the client, clears the cache on success and goes to the front page.

const logoutButton = () => screen.findByRole('button', { name: messages['auth.logout'] });
const noContent = () => new Response(null, { status: 204 });

test('it sends POST /api/auth/logout with no body, no content-type and the CSRF token of the session', async () => {
  const seen = answer(logoutRoute.path, noContent());
  const { user } = renderWithProviders(<AppRouter />, { session: ALICE });
  await user.click(await logoutButton());
  await waitFor(() => {
    expect(seen).toHaveLength(1);
  });
  expect(seen[0]?.method).toBe('POST');
  expect(seen[0]?.text).toBe('');
  expect(seen[0]?.headers['content-type']).toBeUndefined();
  expect(seen[0]?.headers['x-csrf-token']).toBe(CSRF_TOKEN);
  expect(seen[0]?.headers['authorization']).toBeUndefined();
});

test('on success the whole query cache is cleared, nobody is logged in, and the app goes to the front page', async () => {
  answer(logoutRoute.path, noContent());
  const { user, queryClient, setSession } = renderWithProviders(<AppRouter />, {
    session: ALICE,
    route: '/no/such/page',
  });
  const button = await logoutButton();
  queryClient.setQueryData(['repositories', 42], ['one', 'two']);
  const clear = vi.spyOn(queryClient, 'clear');
  setSession(undefined);
  await user.click(button);
  expect(await screen.findByRole('heading', { level: 1, name: messages['app.name'] })).toBeInTheDocument();
  expect(clear).toHaveBeenCalledOnce();
  expect(queryClient.getQueryData(['repositories', 42])).toBeUndefined();
  expect(queryClient.getQueryData(SESSION_KEY)).toEqual({ authenticated: false });
  expect(window.location.pathname).toBe('/');
  expect((await screen.findAllByRole('link', { name: messages['auth.login'] })).length).toBeGreaterThan(0);
  expect(screen.queryByRole('button', { name: messages['auth.logout'] })).toBeNull();
});

test('logging out is not an ended session: no "Your session ended" banner appears', async () => {
  answer(logoutRoute.path, noContent());
  const { user } = renderWithProviders(<AppRouter />, { session: ALICE });
  await user.click(await logoutButton());
  await screen.findAllByRole('link', { name: messages['auth.login'] });
  expect(screen.queryByText(messages['auth.sessionEnded'])).toBeNull();
});

test.each([
  ['Enter', '{Enter}'],
  ['Space', ' '],
])('the button is operable with the keyboard: Tab, then %s', async (_key, keys) => {
  const seen = answer(logoutRoute.path, noContent());
  const { user } = renderWithProviders(<AppRouter />, { session: ALICE });
  const button = await logoutButton();
  button.focus();
  await user.keyboard(keys);
  await waitFor(() => {
    expect(seen).toHaveLength(1);
  });
});

test('a second click while the first is pending sends nothing, and the button says it is busy and keeps the focus', async () => {
  let sent = 0;
  const { user } = renderWithProviders(<AppRouter />, { session: ALICE });
  server.use(
    http.post(logoutRoute.path, async () => {
      sent += 1;
      await delay(80);
      return noContent();
    }),
  );
  const button = await logoutButton();
  await user.click(button);
  await user.click(button);
  await user.dblClick(button);
  expect(button).toHaveAttribute('aria-busy', 'true');
  expect(button).toHaveFocus();
  await screen.findAllByRole('link', { name: messages['auth.login'] });
  expect(sent).toBe(1);
});

function TwiceInOneClick() {
  const logout = useLogout();
  return (
    <button
      type="button"
      onClick={() => {
        logout.run();
        logout.run();
      }}
    >
      twice
    </button>
  );
}

test('two calls in the same moment, before the page can show the pending state, send one request', async () => {
  const seen = answer(logoutRoute.path, noContent());
  const { user } = renderWithProviders(
    <TestAppRoutes route="/open" pages={[{ path: '/open', access: 'public', component: TwiceInOneClick }]} />,
    { session: ALICE },
  );
  await user.click(await screen.findByRole('button', { name: 'twice' }));
  await waitFor(() => {
    expect(screen.queryByRole('button', { name: 'twice' })).toBeNull();
  });
  expect(seen).toHaveLength(1);
});

test('a failure shows an error banner with the request id, keeps the person logged in, and clears nothing', async () => {
  answer(logoutRoute.path, envelope(500, 'internal_server_error'));
  const { user, queryClient } = renderWithProviders(<AppRouter />, { session: ALICE });
  queryClient.setQueryData(['repositories', 42], ['one']);
  await user.click(await logoutButton());
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(messages['errors.internal_server_error']);
  expect(alert).toHaveTextContent('req-00000001');
  expect(screen.getByRole('button', { name: messages['auth.logout'] })).toBeInTheDocument();
  expect(queryClient.getQueryData(['repositories', 42])).toEqual(['one']);
  expect(queryClient.getQueryData(SESSION_KEY)).toMatchObject({ authenticated: true });
});

test('after a failure the button works again, and a success removes the error with the button', async () => {
  const seen = answer(logoutRoute.path, envelope(500, 'internal_server_error'), noContent());
  const { user } = renderWithProviders(<AppRouter />, { session: ALICE });
  await user.click(await logoutButton());
  await screen.findByRole('alert');
  await user.click(screen.getByRole('button', { name: messages['auth.logout'] }));
  await screen.findAllByRole('link', { name: messages['auth.login'] });
  expect(seen).toHaveLength(2);
  expect(screen.queryByRole('alert')).toBeNull();
});

test('a network failure is an error banner too', async () => {
  const { user } = renderWithProviders(<AppRouter />, { session: ALICE });
  server.use(http.post(logoutRoute.path, () => HttpResponse.error()));
  await user.click(await logoutButton());
  expect(await screen.findByRole('alert')).toHaveTextContent(messages['errors.network']);
});

test('a rejected CSRF token is replaced from the session endpoint and the logout is repeated once', async () => {
  const seen = answer(logoutRoute.path, envelope(403, 'csrf_invalid'), noContent());
  const { user, setSession } = renderWithProviders(<AppRouter />, { session: ALICE });
  const fresh = `${'fr3sh'.repeat(8)}abc`;
  await logoutButton();
  setSession({ ...ALICE, csrfToken: fresh });
  await user.click(screen.getByRole('button', { name: messages['auth.logout'] }));
  await screen.findAllByRole('link', { name: messages['auth.login'] });
  expect(seen.map((request) => request.headers['x-csrf-token'])).toEqual([CSRF_TOKEN, fresh]);
});

test('a logout that finds the session already over is an ended session: the banner says so', async () => {
  answer(logoutRoute.path, envelope(401, 'unauthorized'));
  const { user, setSession } = renderWithProviders(<AppRouter />, { session: ALICE });
  await logoutButton();
  setSession(undefined);
  await user.click(screen.getByRole('button', { name: messages['auth.logout'] }));
  expect(await screen.findByText(messages['auth.sessionEnded'])).toBeInTheDocument();
});

test('the button and a failure pass axe', async () => {
  answer(logoutRoute.path, envelope(500, 'internal_server_error'));
  const { user, container } = renderWithProviders(<AppRouter />, { session: ALICE });
  await expectNoA11yViolations((await logoutButton()).parentElement ?? container);
  await user.click(screen.getByRole('button', { name: messages['auth.logout'] }));
  await screen.findByRole('alert');
  await expectNoA11yViolations(container);
});

// The body of E10's logout is strict (E10-S06): none, `{}` or `{ "everywhere": true }`; any other key is a 400.
const LOGOUT_BODIES = [
  ['no body', undefined, ''],
  ['an empty object', {}, '{}'],
  ['everywhere', { everywhere: true }, '{"everywhere":true}'],
] as const;

test.each(LOGOUT_BODIES)('the client sends %s as the server accepts it', async (_what, body, text) => {
  const seen = answer(logoutRoute.path, noContent());
  const queryClient = renderWithProviders(<p>page</p>, { session: ALICE }).queryClient;
  queryClient.setQueryData(SESSION_KEY, {
    authenticated: true,
    user: ALICE.user,
    csrfToken: CSRF_TOKEN,
    expiresAt: ALICE.expiresAt,
  });
  await authFor(queryClient).client.call(logoutRoute, body === undefined ? undefined : { body });
  expect(seen[0]?.text).toBe(text);
  expect(seen[0]?.headers['content-type']).toBe(body === undefined ? undefined : 'application/json');
});

test('a body with a key the server does not know is refused by the client before anything is sent', async () => {
  const seen = answer(logoutRoute.path, noContent());
  const { queryClient } = renderWithProviders(<p>page</p>, { session: ALICE });
  const hostile = { everywhere: true, userId: 7 };
  const error = await rejection(authFor(queryClient).client.call(logoutRoute, { body: hostile }));
  expect(error).toBeInstanceOf(ContractError);
  expect(seen).toHaveLength(0);
});
