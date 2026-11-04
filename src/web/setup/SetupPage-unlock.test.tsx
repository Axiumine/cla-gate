// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor } from '@testing-library/react';
import { HttpResponse } from 'msw';
import { afterEach, expect, test, vi } from 'vitest';
import { json } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { AppRouter } from '../router.tsx';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { failure, SETUP_CSRF, SETUP_TOKEN, serveConfigured, serveSetup, spyOnConsole } from './test-support.ts';

// E19-S07: /setup asks for the status first, then shows the unlock form. The token goes in the JSON body of the unlock and
// nowhere else, and the error codes of the unlock have catalog messages.

afterEach(() => {
  vi.restoreAllMocks();
});

const tokenField = () => screen.findByLabelText(messages['setup.unlock.token']);
const unlockButton = () => screen.getByRole('button', { name: messages['setup.unlock.submit'] });

test('it asks for the status before anything else, and shows nothing of the form until the answer is in', async () => {
  const calls = serveSetup();
  renderWithProviders(<AppRouter />, { route: '/setup' });
  expect(screen.queryByLabelText(messages['setup.unlock.token'])).toBeNull();
  await tokenField();
  expect(calls.status).toHaveLength(1);
  expect(calls.status[0]?.method).toBe('GET');
  expect(calls.unlock).toHaveLength(0);
});

test('on a configured server /setup is the shared not-found page, with no form', async () => {
  const calls = serveConfigured();
  renderWithProviders(<AppRouter />, { route: '/setup' });
  expect(await screen.findByRole('heading', { level: 1, name: messages['states.notFound.title'] })).toBeInTheDocument();
  expect(screen.getByText(messages['states.notFound.message'])).toBeInTheDocument();
  expect(screen.queryByLabelText(messages['setup.unlock.token'])).toBeNull();
  expect(calls.unlock).toHaveLength(0);
});

test('a status that cannot be read is an error with "Try again", which asks again', async () => {
  const calls = serveSetup({ status: failure(503, 'service_unavailable') });
  const { user } = renderWithProviders(<AppRouter />, { route: '/setup' });
  expect(await screen.findByRole('alert')).toHaveTextContent(messages['errors.service_unavailable']);
  expect(screen.queryByLabelText(messages['setup.unlock.token'])).toBeNull();
  const again = serveSetup();
  await user.click(screen.getByRole('button', { name: messages['states.retry'] }));
  await tokenField();
  expect(calls.status.length).toBeGreaterThanOrEqual(1);
  expect(again.status).toHaveLength(1);
});

test('the field is a password input labelled "Setup token", with autocomplete off, and the page says where the token is', async () => {
  serveSetup();
  renderWithProviders(<AppRouter />, { route: '/setup' });
  const field = await tokenField();
  expect(field).toHaveAttribute('type', 'password');
  expect(field).toHaveAttribute('autocomplete', 'off');
  expect(field).toBeRequired();
  expect(screen.getByText(messages['setup.unlock.token'])).toBeInTheDocument();
  expect(screen.getByText(/secrets\/setup_token/u)).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 1, name: messages['setup.unlock.title'] })).toBeInTheDocument();
});

test('the field has no name and the form no action, so no native submit could carry the token into an address', async () => {
  serveSetup();
  const { container } = renderWithProviders(<AppRouter />, { route: '/setup' });
  const field = await tokenField();
  expect(field).not.toHaveAttribute('name');
  const form = container.querySelector('form');
  expect(form).not.toBeNull();
  expect(form).not.toHaveAttribute('action');
  expect(form?.getAttribute('method') ?? 'get').not.toBe('post');
});

test('the token is sent once, as JSON in the body of a POST, and appears in no address, header or storage', async () => {
  const calls = serveSetup();
  const { user } = renderWithProviders(<AppRouter />, { route: '/setup' });
  await user.type(await tokenField(), SETUP_TOKEN);
  await user.click(unlockButton());
  await screen.findByRole('heading', { level: 1, name: messages['setup.app.title'] });
  expect(calls.unlock).toHaveLength(1);
  const [sent] = calls.unlock;
  expect(sent?.method).toBe('POST');
  expect(JSON.parse(sent?.text ?? '')).toEqual({ token: SETUP_TOKEN });
  expect(sent?.headers['content-type']).toBe('application/json');
  expect(sent?.url).not.toContain(SETUP_TOKEN);
  expect(window.location.href).not.toContain(SETUP_TOKEN);
  expect(JSON.stringify(sent?.headers)).not.toContain(SETUP_TOKEN);
  expect(localStorage).toHaveLength(0);
  expect(sessionStorage).toHaveLength(0);
  expect(document.body.innerHTML).not.toContain(SETUP_TOKEN);
});

test('Enter in the field unlocks, and the form step that follows takes focus on its heading', async () => {
  const calls = serveSetup();
  const { user } = renderWithProviders(<AppRouter />, { route: '/setup' });
  await user.type(await tokenField(), `${SETUP_TOKEN}{Enter}`);
  const heading = await screen.findByRole('heading', { level: 1, name: messages['setup.app.title'] });
  expect(calls.unlock).toHaveLength(1);
  await waitFor(() => {
    expect(heading).toHaveFocus();
  });
});

test('the unlock step does not take focus when the page loads, so the first Tab still reaches "Skip to content"', async () => {
  serveSetup();
  const { user } = renderWithProviders(<AppRouter />, { route: '/setup' });
  await tokenField();
  expect(screen.getByRole('heading', { level: 1, name: messages['setup.unlock.title'] })).not.toHaveFocus();
  await user.tab();
  expect(screen.getByRole('link', { name: messages['nav.skip'] })).toHaveFocus();
});

test('an empty token sends nothing', async () => {
  const calls = serveSetup();
  const { user } = renderWithProviders(<AppRouter />, { route: '/setup' });
  await tokenField();
  await user.click(unlockButton());
  expect(calls.unlock).toHaveLength(0);
});

test('a wrong token is 401 invalid_setup_token: its own message, the form stays and the token is not cleared', async () => {
  serveSetup({ unlock: failure(401, 'invalid_setup_token') });
  const { user } = renderWithProviders(<AppRouter />, { route: '/setup' });
  const field = await tokenField();
  await user.type(field, 'wrong');
  await user.click(unlockButton());
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(messages['errors.invalid_setup_token']);
  expect(alert).not.toHaveTextContent(messages['errors.unauthenticated']);
  expect(screen.getByLabelText(messages['setup.unlock.token'])).toHaveValue('wrong');
  expect(screen.queryByRole('heading', { name: messages['setup.app.title'] })).toBeNull();
});

test.each([
  [429, 'too_many_requests', messages['errors.too_many_requests']],
  [403, 'origin_mismatch', messages['errors.origin_mismatch']],
  [500, 'internal_server_error', messages['errors.internal_server_error']],
  [400, 'bad_request', messages['errors.bad_request']],
] as const)('a %i %s answer to the unlock shows %s', async (status, code, message) => {
  serveSetup({ unlock: failure(status, code, status === 429 ? { 'retry-after': '30' } : {}) });
  const { user } = renderWithProviders(<AppRouter />, { route: '/setup' });
  await user.type(await tokenField(), 'anything');
  await user.click(unlockButton());
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
});

test('an answer that is not the contract is the generic contract message, with no payload text', async () => {
  serveSetup({ unlock: json({ csrfToken: 'short', leaked: 'payload-text' }) });
  const { user } = renderWithProviders(<AppRouter />, { route: '/setup' });
  await user.type(await tokenField(), 'anything');
  await user.click(unlockButton());
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(messages['errors.contract']);
  expect(alert).not.toHaveTextContent('payload-text');
});

test('the button is busy while the unlock is under way and a second press sends nothing', async () => {
  const calls = serveSetup();
  const { user } = renderWithProviders(<AppRouter />, { route: '/setup' });
  await user.type(await tokenField(), SETUP_TOKEN);
  await user.dblClick(unlockButton());
  await screen.findByRole('heading', { level: 1, name: messages['setup.app.title'] });
  expect(calls.unlock).toHaveLength(1);
});

test('the token is cleared from the field once it was accepted: the form step has no token field at all', async () => {
  serveSetup();
  const { user } = renderWithProviders(<AppRouter />, { route: '/setup' });
  await user.type(await tokenField(), SETUP_TOKEN);
  await user.click(unlockButton());
  await screen.findByRole('heading', { level: 1, name: messages['setup.app.title'] });
  expect(screen.queryByLabelText(messages['setup.unlock.token'])).toBeNull();
  expect(document.body.innerHTML).not.toContain(SETUP_TOKEN);
});

test('the unlock step is reachable and usable by keyboard alone: Tab reaches the field, then the button, and Enter unlocks', async () => {
  const calls = serveSetup();
  const { user } = renderWithProviders(<AppRouter />, { route: '/setup' });
  const field = await tokenField();
  for (let presses = 0; presses < 10 && document.activeElement !== field; presses += 1) {
    await user.tab();
  }
  expect(field).toHaveFocus();
  await user.keyboard(SETUP_TOKEN);
  await user.tab();
  expect(unlockButton()).toHaveFocus();
  await user.keyboard('{Enter}');
  await screen.findByRole('heading', { level: 1, name: messages['setup.app.title'] });
  expect(calls.unlock).toHaveLength(1);
});

test('the console hears nothing of the token or the CSRF token', async () => {
  const logged = spyOnConsole();
  serveSetup({ unlock: failure(401, 'invalid_setup_token') });
  const { user } = renderWithProviders(<AppRouter />, { route: '/setup' });
  await user.type(await tokenField(), SETUP_TOKEN);
  await user.click(unlockButton());
  await screen.findByRole('alert');
  expect(logged()).not.toContain(SETUP_TOKEN);
  expect(logged()).not.toContain(SETUP_CSRF);
});

test('the unlock step, with and without an error, passes axe', async () => {
  serveSetup({ unlock: failure(401, 'invalid_setup_token') });
  const { container, user } = renderWithProviders(<AppRouter />, { route: '/setup' });
  await user.type(await tokenField(), 'wrong');
  await expectNoA11yViolations(container);
  await user.click(unlockButton());
  await screen.findByRole('alert');
  await expectNoA11yViolations(container);
});

test('a request that never reaches the server is the network message', async () => {
  const calls = serveSetup({ unlock: HttpResponse.error() });
  const { user } = renderWithProviders(<AppRouter />, { route: '/setup' });
  await user.type(await tokenField(), 'anything');
  await user.click(unlockButton());
  expect(await screen.findByRole('alert')).toHaveTextContent(messages['errors.network']);
  expect(calls.unlock).toHaveLength(1);
});
