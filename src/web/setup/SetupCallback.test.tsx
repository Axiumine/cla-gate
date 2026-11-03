// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { act, screen, waitFor } from '@testing-library/react';
import { delay, HttpResponse, http } from 'msw';
import { StrictMode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { setupConvertRoute } from '../../shared/setup.ts';
import { json } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { AppRouter } from '../router.tsx';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { server } from '../test-support/server.ts';
import { CODE, CONVERTED, failure, SETUP_CSRF, STATE, serveConfigured, serveSetup } from './test-support.ts';

// E19-S07: /setup/callback. GitHub sends the browser back with a code and a state; the page reads them, cleans the address,
// and converts only when the button is pressed.

afterEach(() => {
  vi.restoreAllMocks();
});

const ROUTE = `/setup/callback?code=${CODE}&state=${STATE}`;
const getButton = () => screen.findByRole('button', { name: messages['setup.callback.get'] });

test('the code and the state leave the address bar as the page mounts: replaceState puts the bare path in their place', async () => {
  serveSetup();
  const replace = vi.spyOn(window.history, 'replaceState');
  renderWithProviders(<AppRouter />, { route: ROUTE });
  await waitFor(() => {
    expect(replace).toHaveBeenCalledWith(expect.anything(), '', '/setup/callback');
  });
  expect(window.location.pathname).toBe('/setup/callback');
  expect(window.location.search).toBe('');
  expect(window.location.href).not.toContain(CODE);
  expect(window.location.href).not.toContain(STATE);
});

test('it reads them before it cleans the address, so the button still has the code and the state it was sent back with', async () => {
  const calls = serveSetup();
  const { user } = renderWithProviders(<AppRouter />, { route: ROUTE });
  await user.click(await getButton());
  await screen.findByRole('heading', { level: 1, name: messages['setup.credentials.title'] });
  expect(calls.convert).toHaveLength(1);
  expect(JSON.parse(calls.convert[0]?.text ?? '')).toEqual({ code: CODE, state: STATE });
});

test('a code of digits only reaches the server exactly as GitHub wrote it, not as the number the router would make of it', async () => {
  const calls = serveSetup();
  const { user } = renderWithProviders(<AppRouter />, {
    route: `/setup/callback?code=12345678901234567890&state=${STATE}`,
  });
  await user.click(await getButton());
  await screen.findByRole('heading', { level: 1, name: messages['setup.credentials.title'] });
  expect(JSON.parse(calls.convert[0]?.text ?? '')).toEqual({ code: '12345678901234567890', state: STATE });
});

test('it shows a heading and a button "Get the credentials", and the heading is not focused on load', async () => {
  serveSetup();
  renderWithProviders(<AppRouter />, { route: ROUTE });
  const heading = await screen.findByRole('heading', { level: 1, name: messages['setup.callback.title'] });
  expect(await getButton()).toBeInTheDocument();
  expect(screen.getByText(messages['setup.callback.intro'])).toBeInTheDocument();
  expect(heading).not.toHaveFocus();
});

test('the page sets referrer no-referrer in the document head, and the meta goes with the page', async () => {
  serveSetup();
  const { unmount } = renderWithProviders(<AppRouter />, { route: ROUTE });
  await getButton();
  expect(document.head.querySelector('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
  unmount();
  expect(document.head.querySelector('meta[name="referrer"]')).toBeNull();
});

test('a GET of the page never converts: not on load, not when React runs every effect twice, not however long it waits', async () => {
  const calls = serveSetup();
  renderWithProviders(
    <StrictMode>
      <AppRouter />
    </StrictMode>,
    { route: ROUTE },
  );
  await getButton();
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(calls.convert).toHaveLength(0);
  expect(calls.manifest).toHaveLength(0);
  expect(calls.unlock).toHaveLength(0);
  expect(calls.session.every((seen) => seen.method === 'GET')).toBe(true);
});

test('the CSRF token comes from the session endpoint after the round trip, and goes in x-csrf-token with the cookie of the page', async () => {
  const calls = serveSetup();
  const { user } = renderWithProviders(<AppRouter />, { route: ROUTE });
  await user.click(await getButton());
  await screen.findByRole('heading', { level: 1, name: messages['setup.credentials.title'] });
  const [sent] = calls.convert;
  expect(sent?.method).toBe('POST');
  expect(sent?.headers['x-csrf-token']).toBe(SETUP_CSRF);
  expect(sent?.headers['content-type']).toBe('application/json');
  expect(sent?.headers['authorization']).toBeUndefined();
  expect(calls.session[0]?.method).toBe('GET');
});

test('the button shows loading while the conversion runs, and a double click sends one request', async () => {
  serveSetup();
  let received = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  server.use(
    http.post(setupConvertRoute.path, async () => {
      received += 1;
      await gate;
      return HttpResponse.json(CONVERTED);
    }),
  );
  const { user } = renderWithProviders(<AppRouter />, { route: ROUTE });
  const button = await getButton();
  await user.dblClick(button);
  await waitFor(() => {
    expect(button).toHaveAttribute('aria-busy', 'true');
  });
  await user.click(button);
  expect(received).toBe(1);
  release();
  await screen.findByRole('heading', { level: 1, name: messages['setup.credentials.title'] });
  expect(received).toBe(1);
});

test('two clicks in the same instant, before the page has drawn the busy button, still send one request', async () => {
  const calls = serveSetup();
  renderWithProviders(<AppRouter />, { route: ROUTE });
  const button = await getButton();
  act(() => {
    button.click();
    button.click();
  });
  await screen.findByRole('heading', { level: 1, name: messages['setup.credentials.title'] });
  expect(calls.convert).toHaveLength(1);
});

test('while the session is being read the page shows the loading state and no button', async () => {
  serveSetup();
  server.use(
    http.get('/api/setup/session', async () => {
      await delay(50);
      return HttpResponse.json({ csrfToken: SETUP_CSRF });
    }),
  );
  renderWithProviders(<AppRouter />, { route: ROUTE });
  expect(await screen.findByText(messages['states.loading'])).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: messages['setup.callback.get'] })).toBeNull();
  await getButton();
});

test('on a configured server the callback is the not-found page, asks for no token and converts nothing', async () => {
  const calls = serveConfigured();
  renderWithProviders(<AppRouter />, { route: ROUTE });
  expect(await screen.findByRole('heading', { level: 1, name: messages['states.notFound.title'] })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: messages['setup.callback.get'] })).toBeNull();
  expect(calls.session).toHaveLength(0);
  expect(calls.convert).toHaveLength(0);
  expect(window.location.search).toBe('');
});

test.each([
  ['no parameters', '/setup/callback'],
  ['an error from GitHub', '/setup/callback?error=access_denied'],
  ['a code and no state', `/setup/callback?code=${CODE}`],
  ['a state and no code', `/setup/callback?state=${STATE}`],
  ['a state of the wrong length', `/setup/callback?code=${CODE}&state=${'s'.repeat(42)}`],
  ['a code with a slash', `/setup/callback?code=ab%2Fcd&state=${STATE}`],
  ['two codes', `/setup/callback?code=${CODE}&code=${CODE}&state=${STATE}`],
  ['a code of markup', `/setup/callback?code=${encodeURIComponent('<img src=x onerror=alert(1)>')}&state=${STATE}`],
])('%s is not a return from GitHub: the page says so and asks the server for nothing', async (_what, route) => {
  const calls = serveSetup();
  const { container } = renderWithProviders(<AppRouter />, { route });
  expect(
    await screen.findByRole('heading', { level: 1, name: messages['setup.callback.invalidTitle'] }),
  ).toBeInTheDocument();
  expect(screen.getByText(messages['setup.callback.invalid'])).toBeInTheDocument();
  expect(screen.getByRole('link', { name: messages['setup.startAgain'] })).toHaveAttribute('href', '/setup');
  expect(screen.queryByRole('button', { name: messages['setup.callback.get'] })).toBeNull();
  expect(calls.session).toHaveLength(0);
  expect(calls.convert).toHaveLength(0);
  expect(container.querySelector('img')).toBeNull();
  expect(window.location.search).toBe('');
});

test('a forged state is the 400 of the server: the page shows the way to start again and no credentials', async () => {
  const calls = serveSetup({ convert: failure(400, 'setup_code_invalid') });
  const { user } = renderWithProviders(<AppRouter />, {
    route: `/setup/callback?code=${CODE}&state=${'f'.repeat(43)}`,
  });
  await user.click(await getButton());
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(messages['errors.setup_code_invalid']);
  expect(JSON.parse(calls.convert[0]?.text ?? '')).toEqual({ code: CODE, state: 'f'.repeat(43) });
  expect(screen.getByRole('link', { name: messages['setup.startAgain'] })).toHaveAttribute('href', '/setup');
  expect(screen.queryByRole('heading', { name: messages['setup.credentials.title'] })).toBeNull();
});

test.each([
  {
    status: 400,
    code: 'setup_code_invalid',
    message: messages['errors.setup_code_invalid'],
    startAgain: true,
    retry: false,
  },
  {
    status: 409,
    code: 'setup_already_issued',
    message: messages['errors.setup_already_issued'],
    startAgain: false,
    retry: false,
  },
  {
    status: 502,
    code: 'github_unreachable',
    message: messages['errors.github_unreachable'],
    startAgain: false,
    retry: true,
  },
  {
    status: 502,
    code: 'github_unexpected_response',
    message: messages['errors.github_unexpected_response'],
    startAgain: true,
    retry: true,
  },
  { status: 401, code: 'setup_locked', message: messages['errors.setup_locked'], startAgain: true, retry: false },
  { status: 403, code: 'csrf_invalid', message: messages['errors.csrf_invalid'], startAgain: false, retry: false },
  {
    status: 403,
    code: 'origin_mismatch',
    message: messages['errors.origin_mismatch'],
    startAgain: false,
    retry: false,
  },
  {
    status: 500,
    code: 'internal_server_error',
    message: messages['errors.internal_server_error'],
    startAgain: false,
    retry: true,
  },
])(
  'a $status $code answer shows its message; the way to start again: $startAgain; "Try again": $retry',
  async ({ status, code, message, startAgain, retry }) => {
    serveSetup({ convert: failure(status, code) });
    const { user } = renderWithProviders(<AppRouter />, { route: ROUTE });
    await user.click(await getButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByRole('link', { name: messages['setup.startAgain'] }) !== null).toBe(startAgain);
    expect(screen.queryByRole('button', { name: messages['states.retry'] }) !== null).toBe(retry);
  },
);

test('the remedies are in the words: start again from the setup page, delete the App and restart the container, retry', () => {
  expect(messages['errors.setup_code_invalid']).toMatch(/Start again from the setup page/u);
  expect(messages['errors.setup_already_issued']).toMatch(/delete the App on GitHub and restart the container/u);
  expect(messages['errors.github_unreachable']).toMatch(/Try again/u);
});

test('github_unreachable offers a retry, and the retry converts', async () => {
  const calls = serveSetup({ convert: failure(502, 'github_unreachable') });
  const { user } = renderWithProviders(<AppRouter />, { route: ROUTE });
  await user.click(await getButton());
  await screen.findByRole('alert');
  const second = serveSetup();
  await user.click(screen.getByRole('button', { name: messages['states.retry'] }));
  await screen.findByRole('heading', { level: 1, name: messages['setup.credentials.title'] });
  expect(calls.convert).toHaveLength(1);
  expect(second.convert).toHaveLength(1);
});

test('a conversion that never reaches the server is the network message, with a retry', async () => {
  serveSetup({ convert: HttpResponse.error() });
  const { user } = renderWithProviders(<AppRouter />, { route: ROUTE });
  await user.click(await getButton());
  expect(await screen.findByRole('alert')).toHaveTextContent(messages['errors.network']);
  expect(screen.getByRole('button', { name: messages['states.retry'] })).toBeInTheDocument();
});

test('an answer that is not the contract is the generic contract message and shows none of its text', async () => {
  serveSetup({ convert: json({ appId: 'not a number', clientSecret: 'text-from-the-answer' }) });
  const { user } = renderWithProviders(<AppRouter />, { route: ROUTE });
  await user.click(await getButton());
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(messages['errors.contract']);
  expect(document.body.innerHTML).not.toContain('text-from-the-answer');
});

test('a setup session that has ended is 401 setup_locked when the token is read: the way to start again, and no button', async () => {
  const calls = serveSetup({ session: failure(401, 'setup_locked') });
  renderWithProviders(<AppRouter />, { route: ROUTE });
  expect(await screen.findByRole('alert')).toHaveTextContent(messages['errors.setup_locked']);
  expect(screen.getByRole('link', { name: messages['setup.startAgain'] })).toHaveAttribute('href', '/setup');
  expect(screen.queryByRole('button', { name: messages['setup.callback.get'] })).toBeNull();
  expect(screen.queryByRole('button', { name: messages['states.retry'] })).toBeNull();
  expect(calls.convert).toHaveLength(0);
});

test('a token that cannot be read because the server failed offers "Try again", which reads it again', async () => {
  serveSetup({ session: failure(503, 'service_unavailable') });
  const { user } = renderWithProviders(<AppRouter />, { route: ROUTE });
  expect(await screen.findByRole('alert')).toHaveTextContent(messages['errors.service_unavailable']);
  serveSetup();
  await user.click(screen.getByRole('button', { name: messages['states.retry'] }));
  expect(await getButton()).toBeInTheDocument();
});

test('the button is operable by keyboard: Tab reaches it, Enter converts', async () => {
  const calls = serveSetup();
  const { user } = renderWithProviders(<AppRouter />, { route: ROUTE });
  const button = await getButton();
  for (let presses = 0; presses < 10 && document.activeElement !== button; presses += 1) {
    await user.tab();
  }
  expect(button).toHaveFocus();
  await user.keyboard('{Enter}');
  await screen.findByRole('heading', { level: 1, name: messages['setup.credentials.title'] });
  expect(calls.convert).toHaveLength(1);
});

test('every step of the callback passes axe: the button, an error, the page that is not a return', async () => {
  serveSetup({ convert: failure(400, 'setup_code_invalid') });
  const { container, user, unmount } = renderWithProviders(<AppRouter />, { route: ROUTE });
  await user.click(await getButton());
  await screen.findByRole('alert');
  await expectNoA11yViolations(container);
  unmount();
  const idle = renderWithProviders(<AppRouter />, { route: ROUTE });
  await getButton();
  await expectNoA11yViolations(idle.container);
  idle.unmount();
  const other = renderWithProviders(<AppRouter />, { route: '/setup/callback' });
  await screen.findByRole('heading', { level: 1, name: messages['setup.callback.invalidTitle'] });
  await expectNoA11yViolations(other.container);
});
