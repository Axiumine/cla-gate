// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useQueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import { LOGIN_FAILED_PATH, loginFailureReasonSchema } from '../shared/auth.ts';
import { RootLayout } from './layout/RootLayout.tsx';
import { LandingPage } from './pages/LandingPage.tsx';
import { LoginFailedPage } from './pages/LoginFailedPage.tsx';
import { type RouterContext, withAccess } from './route-access.ts';
import { NotFoundPage, RouterErrorComponent } from './states/index.ts';

// The route tree of the app (E17-S08), written in code: no generator, no generated file. Every route spreads
// `withAccess(...)`, which is where it says who may see it. E18 adds the sign page and the maintainer screens here, and E19
// the setup pages.

const rootRoute = createRootRouteWithContext<RouterContext>()({
  ...withAccess('public'),
  component: RootLayout,
  notFoundComponent: NotFoundPage,
  errorComponent: RouterErrorComponent,
});

const landingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  ...withAccess('public'),
  component: LandingPage,
});

/** `?reason=` of the login callback's failure redirect: one of the known codes, else nothing. The raw value goes no further. */
const loginFailedSearch = z.object({ reason: loginFailureReasonSchema.optional().catch(undefined) });

const loginFailedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: LOGIN_FAILED_PATH,
  ...withAccess('public'),
  validateSearch: loginFailedSearch,
  component: function LoginFailedRoute() {
    return <LoginFailedPage reason={loginFailedRoute.useSearch().reason} />;
  },
});

// type-coverage:ignore-next-line -- TanStack Router's route tree type holds any in its own definition (RouteWithChildren)
const routeTree = rootRoute.addChildren([landingRoute, loginFailedRoute]);

/**
 * A router for `queryClient`, on the browser history. The query client is what the routes and their guards read the session through.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export function createAppRouter(queryClient: RouterContext['queryClient']) {
  // type-coverage:ignore-next-line -- the route tree type holds any, see above
  return createRouter({ routeTree, context: { queryClient } });
}

declare module '@tanstack/react-router' {
  interface Register {
    // type-coverage:ignore-next-line -- the router type is made from the route tree, which holds any
    router: ReturnType<typeof createAppRouter>;
  }
}

/** The router, rendered. It is made once per mount, for the query client of the providers above it. */
export function AppRouter() {
  const queryClient = useQueryClient();
  // type-coverage:ignore-next-line -- the router type is made from the route tree, which holds any
  const [router] = useState(() => createAppRouter(queryClient));
  // type-coverage:ignore-next-line -- the router type is made from the route tree, which holds any
  return <RouterProvider router={router} />;
}
