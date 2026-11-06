// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useQueryClient } from '@tanstack/react-query';
import { createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import { LOGIN_FAILED_PATH, loginFailureReasonSchema } from '../shared/auth.ts';
import { SETUP_CALLBACK_PATH, SETUP_PATH } from '../shared/routes.ts';
import { corporateAgreementsRoute, corporateClaimRoute, corporateSignRoute } from './corporate/corporate-routes.tsx';
import { AppShell } from './layout/AppShell.tsx';
import { LandingPage } from './pages/LandingPage.tsx';
import { LoginFailedPage } from './pages/LoginFailedPage.tsx';
import { rootRoute } from './root-route.ts';
import { type RouterContext, withAccess } from './route-access.ts';
import { SetupCallbackPage } from './setup/SetupCallbackPage.tsx';
import { SetupPage } from './setup/SetupPage.tsx';
import { parseGithubRepoId, signSearchSchema } from './sign/params.ts';
import { SignPage } from './sign/SignPage.tsx';
import {
  installationsRoute,
  mySignaturesRoute,
  operatorInstallationsRoute,
  repositorySettingsRoute,
} from './signed-in-routes.tsx';
import { tenantRoutes } from './tenant-routes.tsx';

// The route tree of the app (E17-S08), written in code: no generator, no generated file. Every route spreads
// `withAccess(...)`, which is where it says who may see it. The sign page and the setup pages (E19-S07) are below; the screens of a
// signed-in person are in signed-in-routes.tsx, the screens of one tenant in tenant-routes.tsx and the corporate routes (E21) in
// corporate/corporate-routes.tsx.

const landingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  ...withAccess('public', { title: 'landing.title' }),
  component: LandingPage,
});

/** `?reason=` of the login callback's failure redirect: one of the known codes, else nothing. The raw value goes no further. */
const loginFailedSearch = z.object({ reason: loginFailureReasonSchema.optional().catch(undefined) });

const loginFailedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: LOGIN_FAILED_PATH,
  ...withAccess('public', { title: 'login.failed.title' }),
  validateSearch: loginFailedSearch,
  component: function LoginFailedRoute() {
    return <LoginFailedPage reason={loginFailedRoute.useSearch().reason} />;
  },
});

// The first-run setup (E19-S07): public, because there is no login while there is no App. Both pages ask the server for the
// setup status first, and on a configured server they are the not-found page (the server answers 404 for the paths too).
const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: SETUP_PATH,
  ...withAccess('public', { title: 'setup.title' }),
  component: SetupPage,
});

const setupCallbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: SETUP_CALLBACK_PATH,
  ...withAccess('public', { title: 'setup.title' }),
  component: SetupCallbackPage,
});

// The sign page (E18-S01): the link of the pull request comment. Public, because it tells a visitor who is not logged in what
// signing involves and offers the login (E18-S02); the data it shows is read with the session, so a visitor sees none of it.
// A repository id that is not a plain positive number is no page of the app (the route does not match; `false` skips it), and
// a `?pr=` that is not a pull request number is dropped.
const signRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sign/$githubRepoId',
  ...withAccess('public', { title: 'sign.title' }),
  params: {
    parse: ({ githubRepoId }) => {
      const parsed = parseGithubRepoId(githubRepoId);
      return parsed === undefined ? false : { githubRepoId: parsed };
    },
    stringify: ({ githubRepoId }) => ({ githubRepoId: String(githubRepoId) }),
  },
  validateSearch: signSearchSchema,
  component: function SignRoute() {
    return <SignPage githubRepoId={signRoute.useParams().githubRepoId} pr={signRoute.useSearch().pr} />;
  },
});

// type-coverage:ignore-next-line -- TanStack Router's route tree type holds any in its own definition (RouteWithChildren)
const routeTree = rootRoute.addChildren([
  landingRoute,
  loginFailedRoute,
  setupRoute,
  setupCallbackRoute,
  repositorySettingsRoute,
  signRoute,
  mySignaturesRoute,
  installationsRoute,
  tenantRoutes,
  operatorInstallationsRoute,
  corporateSignRoute,
  corporateClaimRoute,
  corporateAgreementsRoute,
]);

/**
 * A router for `queryClient`, on the browser history. The query client is what the routes and their guards read the session through.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export function createAppRouter(queryClient: RouterContext['queryClient']) {
  // type-coverage:ignore-next-line -- the route tree type holds any, see above
  return createRouter({ routeTree, context: { queryClient }, InnerWrap: AppShell });
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
