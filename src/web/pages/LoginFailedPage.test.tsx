// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { loginFailedPath, loginFailureReasonSchema } from '../../shared/auth.ts';
import { messages } from '../i18n/index.ts';
import { AppRouter } from '../router.tsx';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { renderWithProviders } from '../test-support/render.tsx';

// E17-S08: /login/failed?reason=<code>, where E10's failure redirect lands. The words come from the catalog by the code, and
// the value of the query never reaches the screen.

const REASONS = [
  'state_mismatch',
  'access_denied',
  'exchange_failed',
  'github_unavailable',
  'unsupported_account',
  'bad_request',
] as const;

test.each(REASONS)('the reason %s has a message under login.failed.<code>', (reason) => {
  const message = messages[`login.failed.${reason}`];
  expect(message).toBeTruthy();
  expect(message).not.toBe(messages['login.failed.generic']);
});

test('the reasons the server can redirect with are exactly the ones this page has a message for', () => {
  const byName = (a: string, b: string) => a.localeCompare(b);
  expect([...loginFailureReasonSchema.options].sort(byName)).toEqual([...REASONS].sort(byName));
  for (const reason of loginFailureReasonSchema.options) {
    expect(Object.keys(messages)).toContain(`login.failed.${reason}`);
  }
});

test.each(REASONS)('the redirect for %s shows its message under the level-one heading', async (reason) => {
  renderWithProviders(<AppRouter />, { route: loginFailedPath(reason) });
  expect(await screen.findByRole('heading', { level: 1, name: messages['login.failed.title'] })).toBeInTheDocument();
  expect(screen.getByText(messages[`login.failed.${reason}`])).toBeInTheDocument();
  expect(screen.queryByText(messages['login.failed.generic'])).toBeNull();
});

test.each([
  ['no reason at all', '/login/failed'],
  ['an empty reason', '/login/failed?reason='],
  ['a code that is not one of ours', '/login/failed?reason=made_up'],
  ['a script', `/login/failed?reason=${encodeURIComponent('<script>alert(1)</script>')}`],
  ['a name from the prototype chain', '/login/failed?reason=constructor'],
  ['a name that would write to it', '/login/failed?reason=__proto__'],
  ['a number', '/login/failed?reason=1'],
  ['a JSON object', `/login/failed?reason=${encodeURIComponent('{"a":1}')}`],
  ['the same name in another case', '/login/failed?reason=ACCESS_DENIED'],
  ['a known code and a second value', '/login/failed?reason=access_denied&reason=bad_request'],
  ['a known code with a space', '/login/failed?reason=access_denied%20'],
])('%s shows the generic message', async (_what, route) => {
  renderWithProviders(<AppRouter />, { route });
  expect(await screen.findByText(messages['login.failed.generic'])).toBeInTheDocument();
  for (const reason of REASONS) {
    expect(screen.queryByText(messages[`login.failed.${reason}`])).toBeNull();
  }
});

test('the raw value of the query is never put on the screen', async () => {
  const hostile = '<img src=x onerror=alert(1)>';
  const { container } = renderWithProviders(<AppRouter />, {
    route: `/login/failed?reason=${encodeURIComponent(hostile)}`,
  });
  await screen.findByText(messages['login.failed.generic']);
  expect(container.textContent).not.toContain('onerror');
  expect(container.innerHTML).not.toContain('onerror');
  expect(container.querySelector('img')).toBeNull();
});

test('"Try again" is a plain link to the login start, so the browser loads it as a page', async () => {
  renderWithProviders(<AppRouter />, { route: loginFailedPath('exchange_failed') });
  const retry = await screen.findByRole('link', { name: messages['login.failed.retry'] });
  expect(retry).toHaveAttribute('href', '/api/auth/login');
  const defaultPrevented: boolean[] = [];
  const record = (event: Event) => {
    defaultPrevented.push(event.defaultPrevented);
    event.preventDefault();
  };
  document.addEventListener('click', record);
  retry.click();
  document.removeEventListener('click', record);
  expect(defaultPrevented).toEqual([false]);
});

test('the link home goes to the front page by the router, without loading a page', async () => {
  const { user } = renderWithProviders(<AppRouter />, { route: loginFailedPath('access_denied') });
  await user.click(await screen.findByRole('link', { name: messages['login.failed.home'] }));
  expect(await screen.findByRole('heading', { level: 1, name: messages['app.name'] })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/');
});

test('the page sits inside the layout of the app: the content is in the main landmark and the account control is outside it', async () => {
  renderWithProviders(<AppRouter />, { route: loginFailedPath('access_denied') });
  const heading = await screen.findByRole('heading', { level: 1 });
  expect(screen.getByRole('main')).toContainElement(heading);
  const header = await screen.findAllByRole('link', { name: messages['auth.login'] });
  expect(header).toHaveLength(1);
  expect(screen.getByRole('main')).not.toContainElement(header[0] ?? null);
});

test('after a failed login the header offers the login without sending the person back to this page', async () => {
  renderWithProviders(<AppRouter />, { route: loginFailedPath('access_denied') });
  const login = await screen.findByRole('link', { name: messages['auth.login'] });
  expect(login).toHaveAttribute('href', '/api/auth/login');
});

test('the page passes axe', async () => {
  const { container } = renderWithProviders(<AppRouter />, { route: loginFailedPath('bad_request') });
  await screen.findByRole('heading', { level: 1, name: messages['login.failed.title'] });
  await expectNoA11yViolations(container);
});
