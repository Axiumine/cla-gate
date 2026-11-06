// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { expect, test } from 'vitest';
import { sessionRoute } from '../shared/auth-contract.ts';
import { createQueryClient } from './api/index.ts';
import { messages } from './i18n/index.ts';
import type { RouterContext } from './route-access.ts';
import { AppRouter, createAppRouter } from './router.tsx';
import { expectNoA11yViolations } from './test-support/a11y.ts';
import { renderWithProviders } from './test-support/render.tsx';
import { accessById, type RouteNode, routeAccessProblems, routeTitleProblems } from './test-support/routes.ts';
import { server } from './test-support/server.ts';
import { ALICE } from './test-support/session.ts';

// E17-S08: the code-based route tree, the access every route declares, and the pages of this story.

/** The route tree of a router made for `queryClient`, and the context the router was given. */
function routerFor(queryClient = createQueryClient()): { tree: RouteNode; context: RouterContext } {
  // type-coverage:ignore-next-line -- the router type is made from the route tree, which holds any
  const router = createAppRouter(queryClient);
  // type-coverage:ignore-next-line -- the router type is made from the route tree, which holds any
  return { tree: router.routeTree, context: router.options.context };
}

test('every route of the tree declares its access: this test fails on the route that does not, whoever adds it', () => {
  expect(routeAccessProblems(routerFor().tree)).toEqual([]);
});

test('every route of the tree names its page title, and it is a key of the catalog (E17-S09)', () => {
  expect(routeTitleProblems(routerFor().tree, messages)).toEqual([]);
});

test('the access of every route: the pages of a visitor (front page, failed login, first-run setup, sign page) are public, every screen of a signed-in person needs a login', () => {
  expect(accessById(routerFor().tree)).toEqual({
    __root__: 'public',
    '/': 'public',
    '/login/failed': 'public',
    '/setup': 'public',
    '/setup/callback': 'public',
    '/installations/$installationId/repositories/$repositoryId/settings': 'authenticated',
    '/sign/$githubRepoId': 'public',
    '/me/signatures': 'authenticated',
    '/installations': 'authenticated',
    '/installations/$installationId': 'authenticated',
    '/installations/$installationId/': 'authenticated',
    '/installations/$installationId/repositories': 'authenticated',
    '/installations/$installationId/documents': 'authenticated',
    '/installations/$installationId/documents/$documentId': 'authenticated',
    '/installations/$installationId/allowlist': 'authenticated',
    '/installations/$installationId/signatures': 'authenticated',
    '/installations/$installationId/pending': 'authenticated',
    '/installations/$installationId/audit': 'authenticated',
  });
});

test('the router context is the query client it was made for', () => {
  const queryClient = createQueryClient();
  expect(routerFor(queryClient).context.queryClient).toBe(queryClient);
});

test('the tree is written in code: there is no generated route file in the web source', () => {
  const generated = import.meta.glob('./**/*.gen.{ts,tsx,js,mjs}');
  expect(Object.keys(generated)).toEqual([]);
});

test('the front page is the level-one heading in the main landmark, and a visitor without a session is offered the login', async () => {
  renderWithProviders(<AppRouter />);
  expect(await screen.findByRole('heading', { level: 1, name: messages['app.name'] })).toBeInTheDocument();
  expect(screen.getByRole('main')).toContainElement(screen.getByRole('heading', { level: 1 }));
  const links = await screen.findAllByRole('link', { name: messages['auth.login'] });
  expect(links.map((link) => link.getAttribute('href'))).toEqual(['/api/auth/login?return_to=%2F', '/api/auth/login']);
  expect(screen.getByText(messages['landing.tagline'])).toBeInTheDocument();
});

test('a logged-in visitor is told so instead of being offered the login', async () => {
  renderWithProviders(<AppRouter />, { session: ALICE });
  expect(await screen.findByText(messages['landing.signedIn'])).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: messages['auth.login'] })).toBeNull();
});

test('when the session cannot be learned the front page keeps its heading and shows the error with "Try again", which asks again', async () => {
  const { user } = renderWithProviders(<AppRouter />);
  server.use(
    http.get(sessionRoute.path, () =>
      HttpResponse.json(
        { error: { code: 'internal_server_error', message: 'x', requestId: 'req-1' } },
        { status: 500 },
      ),
    ),
  );
  expect(await screen.findByRole('heading', { level: 1, name: messages['app.name'] })).toBeInTheDocument();
  expect(await screen.findByText(messages['errors.internal_server_error'])).toBeInTheDocument();
  server.use(http.get(sessionRoute.path, () => HttpResponse.json(ALICE)));
  await user.click(screen.getByRole('button', { name: messages['states.retry'] }));
  expect(await screen.findByText(messages['landing.signedIn'])).toBeInTheDocument();
});

test('an unknown path shows the public not-found page for a visitor without a session', async () => {
  renderWithProviders(<AppRouter />, { route: '/no/such/page' });
  expect(await screen.findByRole('heading', { level: 1, name: messages['states.notFound.title'] })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: messages['states.notFound.home'] })).toHaveAttribute('href', '/');
});

test('the front page passes axe, for a visitor without a session and for a logged-in one', async () => {
  const anonymous = renderWithProviders(<AppRouter />);
  await anonymous.findAllByRole('link', { name: messages['auth.login'] });
  await expectNoA11yViolations(anonymous.container);
  anonymous.unmount();
  const loggedIn = renderWithProviders(<AppRouter />, { session: ALICE });
  await loggedIn.findByText(messages['landing.signedIn']);
  await expectNoA11yViolations(loggedIn.container);
});
