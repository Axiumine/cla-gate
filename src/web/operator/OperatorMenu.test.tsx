// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { QueryClient } from '@tanstack/react-query';
import { screen, within } from '@testing-library/react';
import { http } from 'msw';
import { expect, test, vi } from 'vitest';
import { OPERATOR_INSTALLATIONS_PATH } from '../../shared/operator.ts';
import { envelope } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { AppRouter } from '../router.tsx';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { server } from '../test-support/server.ts';
import { OPERATOR_KEY } from './operator-queries.ts';
import { installationOf, operatorLink, operatorList, renderOperator, serveOperator } from './test-support.ts';

// E18-S13: the "Operator" link of the user menu is there only after the endpoint answered 200. A 404 means "not the operator" and is no
// error, and the menu never shows an error of its own: it is not the page that asked.

const menuLink = () => screen.queryByRole('link', { name: messages['operator.link'] });
const logout = () => screen.findByRole('button', { name: messages['auth.logout'] });

test('the operator gets the link, which leads to /operator/installations', async () => {
  serveOperator(operatorList([installationOf()]));
  renderOperator('/');
  expect(await operatorLink()).toHaveAttribute('href', '/operator/installations');
});

test('the link is in the user menu, between the login and "Log out"', async () => {
  serveOperator(operatorList([]));
  renderOperator('/');
  const link = await operatorLink();
  const logoutButton = await logout();
  expect(logoutButton.parentElement).toBe(link.parentElement);
  expect(link.compareDocumentPosition(logoutButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(screen.getByRole('banner')).getByRole('link', { name: messages['operator.link'] })).toBe(link);
});

/** Resolves once the query of the operator endpoint has an answer, whatever it is. */
const answered = (queryClient: QueryClient) =>
  vi.waitFor(() => {
    expect(queryClient.getQueryState(OPERATOR_KEY)?.status).not.toBe('pending');
    expect(queryClient.getQueryState(OPERATOR_KEY)?.fetchStatus).toBe('idle');
  });

test('anyone the endpoint answers 404 gets no link and no error banner', async () => {
  const seen = serveOperator(envelope(404, 'not_found'));
  const { queryClient } = renderOperator('/');
  await logout();
  await answered(queryClient);
  expect(queryClient.getQueryState(OPERATOR_KEY)?.status).toBe('success');
  expect(seen).toHaveLength(1);
  expect(menuLink()).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

test.each([
  [502, 'github_unavailable'],
  [500, 'internal_error'],
])('a %s from the endpoint shows no link and, in the menu, no error either', async (status, code) => {
  serveOperator(envelope(status, code));
  const { queryClient } = renderOperator('/');
  await logout();
  await answered(queryClient);
  expect(queryClient.getQueryState(OPERATOR_KEY)?.status).toBe('error');
  expect(menuLink()).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

test('while the endpoint has not answered there is no link, and when it does the link appears', async () => {
  const gate = Promise.withResolvers<true>();
  server.use(
    http.get(OPERATOR_INSTALLATIONS_PATH, async () => {
      await gate.promise;
      return operatorList([]);
    }),
  );
  renderOperator('/');
  await logout();
  expect(menuLink()).toBeNull();
  gate.resolve(true);
  expect(await operatorLink()).toBeInTheDocument();
});

test('a visitor with no session is not asked: the endpoint is never called and there is no link', async () => {
  const seen = serveOperator(operatorList([installationOf()]));
  renderWithProviders(<AppRouter />);
  await screen.findAllByRole('link', { name: messages['auth.login'] });
  expect(seen).toEqual([]);
  expect(menuLink()).toBeNull();
});

test('the link is reached with the keyboard after the theme choice and before "Log out", and Enter opens the page', async () => {
  serveOperator(operatorList([installationOf()]));
  const { user } = renderOperator('/');
  const link = await operatorLink();
  screen.getByRole('radio', { name: messages['theme.system'] }).focus();
  await user.tab();
  expect(link).toHaveFocus();
  await user.tab();
  expect(await logout()).toHaveFocus();
  link.focus();
  await user.keyboard('{Enter}');
  expect(await screen.findByRole('heading', { level: 1, name: messages['operator.title'] })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/operator/installations');
  expect(link).toHaveAttribute('aria-current', 'page');
});

test('the menu with the link passes axe', async () => {
  serveOperator(operatorList([installationOf()]));
  const { container } = renderOperator('/');
  await operatorLink();
  await expectNoA11yViolations(container);
});
