// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { envelope } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { AppRouter } from '../router.tsx';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { spyOnPageNavigation } from '../test-support/location.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { installationOf, OPERATOR_ROUTE, operatorList, renderOperator, serveOperator } from './test-support.ts';

// E18-S13: the route for someone who is not the operator is the page of a route that does not exist, and a visitor with no session is sent
// to the login before the endpoint is asked.

afterEach(() => {
  vi.unstubAllGlobals();
});

test('opening the route as a non-operator renders the not-found page: its heading, its message, its link home, and no table', async () => {
  serveOperator(envelope(404, 'not_found'));
  renderOperator();
  expect(await screen.findByRole('heading', { level: 1, name: messages['states.notFound.title'] })).toBeInTheDocument();
  expect(screen.getByText(messages['states.notFound.message'])).toBeInTheDocument();
  expect(screen.getByRole('link', { name: messages['states.notFound.home'] })).toHaveAttribute('href', '/');
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByRole('heading', { name: messages['operator.title'] })).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

test('the not-found page of a non-operator says nothing of the operator screen: no link, no sentence of the catalog', async () => {
  serveOperator(envelope(404, 'not_found'));
  renderOperator();
  await screen.findByRole('heading', { level: 1, name: messages['states.notFound.title'] });
  expect(screen.queryByRole('link', { name: messages['operator.link'] })).toBeNull();
  const main = screen.getByRole('main');
  for (const text of [
    messages['operator.intro'],
    messages['operator.admission.note'],
    messages['operator.access.note'],
    messages['operator.caption'],
  ]) {
    expect(main).not.toHaveTextContent(text);
  }
});

test('the not-found page of a non-operator passes axe', async () => {
  serveOperator(envelope(404, 'not_found'));
  const { container } = renderOperator();
  await screen.findByRole('heading', { level: 1, name: messages['states.notFound.title'] });
  await expectNoA11yViolations(container);
});

test("a person who is the operator on the next visit sees the table: the answer is the server's on each visit, not remembered by the person", async () => {
  serveOperator(operatorList([installationOf()]));
  renderOperator();
  expect(await screen.findByRole('table', { name: messages['operator.caption'] })).toBeInTheDocument();
});

test('a visitor with no session is sent to the login before anything loads, and the endpoint is never asked', async () => {
  // The copy of `location` that the spy makes keeps the address the page has, so the page is put on the route first.
  window.history.replaceState(null, '', OPERATOR_ROUTE);
  const assign = spyOnPageNavigation();
  const seen = serveOperator(operatorList([installationOf()]));
  renderWithProviders(createElement(AppRouter), { route: OPERATOR_ROUTE });
  await vi.waitFor(() => {
    expect(assign).toHaveBeenCalledExactlyOnceWith('/api/auth/login?return_to=%2Foperator%2Finstallations');
  });
  expect(seen).toEqual([]);
  expect(screen.queryByRole('table')).toBeNull();
});
