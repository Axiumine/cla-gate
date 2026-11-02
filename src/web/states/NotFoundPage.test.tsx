// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { TestRoutes } from '../test-support/router.tsx';
import { NotFoundPage } from './NotFoundPage.tsx';

// E17-S07: the router's notFoundComponent, a 404 page with a link home.

const pages = [{ path: '/', component: () => <p>The home page</p> }];

function renderLost(route = '/no/such/page') {
  return renderWithProviders(<TestRoutes route={route} pages={pages} notFoundComponent={NotFoundPage} />);
}

test('an unknown path shows the 404 page: an h1, a sentence and a link home', async () => {
  renderLost();
  expect(await screen.findByRole('heading', { level: 1, name: messages['states.notFound.title'] })).toBeInTheDocument();
  expect(screen.getByText(messages['states.notFound.message'])).toBeInTheDocument();
  expect(screen.getByRole('link', { name: messages['states.notFound.home'] })).toHaveAttribute('href', '/');
  expect(screen.queryByText('The home page')).toBeNull();
});

test('a known path does not show it', async () => {
  renderLost('/');
  expect(await screen.findByText('The home page')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: messages['states.notFound.title'] })).toBeNull();
});

test('the link goes home by the mouse, and by Enter', async () => {
  const { user } = renderLost();
  await user.click(await screen.findByRole('link', { name: messages['states.notFound.home'] }));
  expect(await screen.findByText('The home page')).toBeInTheDocument();
});

test('Tab reaches the link, and Enter on it goes home', async () => {
  const { user } = renderLost();
  await screen.findByRole('link');
  await user.tab();
  expect(screen.getByRole('link', { name: messages['states.notFound.home'] })).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(await screen.findByText('The home page')).toBeInTheDocument();
});

test('the page passes axe', async () => {
  const { container } = renderLost();
  await screen.findByRole('heading', { level: 1 });
  await expectNoA11yViolations(container);
});
