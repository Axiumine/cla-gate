// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useQueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import { LOGIN_FAILED_PATH, loginFailureReasonSchema } from '../shared/auth.ts';
import { SETUP_CALLBACK_PATH, SETUP_PATH } from '../shared/routes.ts';
import { CorporateAgreementsPage } from './corporate/CorporateAgreementsPage.tsx';
import { CorporateSignPage } from './corporate/CorporateSignPage.tsx';
import { AppShell } from './layout/AppShell.tsx';
import { LandingPage } from './pages/LandingPage.tsx';
import { LoginFailedPage } from './pages/LoginFailedPage.tsx';
import { RepositorySettingsPage } from './repository-settings/RepositorySettingsPage.tsx';
import { type RouterContext, withAccess } from './route-access.ts';
import { SetupCallbackPage } from './setup/SetupCallbackPage.tsx';
import { SetupPage } from './setup/SetupPage.tsx';
import { NotFoundPage, RouterErrorComponent } from './states/index.ts';

// The route tree of the app (E17-S08), written in code: no generator, no generated file. Every route spreads
// `withAccess(...)`, which is where it says who may see it. E18 adds the sign page and the maintainer screens here; the setup
// pages (E19-S07) are below.

// The root is the deepest match only when no route matched, so its title is the not-found page's.
const rootRoute = createRootRouteWithContext<RouterContext>()({
  ...withAccess('public', { title: 'states.notFound.title' }),
  notFoundComponent: NotFoundPage,
  errorComponent: RouterErrorComponent,
});

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

/** A row id in an address: digits, no sign, no leading zero, at most 15 of them so that the number is always safe. */
const rowIdParam = z
  .string()
  .regex(/^[1-9]\d{0,14}$/)
  .transform(Number);

const repositorySettingsParams = z.object({ installationId: rowIdParam, repositoryId: rowIdParam });

// The settings screen of a repository (E22-S03), for a signed-in person; the server decides who may see and change what is on it.
// An address whose ids are not row ids matches no route, so it is the not-found page and never a call with a made-up id.
const repositorySettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/installations/$installationId/repositories/$repositoryId/settings',
  ...withAccess('authenticated', { title: 'repository.settings.title' }),
  params: {
    parse: (raw) => {
      const parsed = repositorySettingsParams.safeParse(raw);
      return parsed.success ? parsed.data : false;
    },
  },
  component: function RepositorySettingsRoute() {
    return <RepositorySettingsPage {...repositorySettingsRoute.useParams()} />;
  },
});

// Corporate signing (E21-S02): the page where an authorised signatory signs for a company, and the list of the agreements a person
// signed. Both need a login. The paths are those of CORPORATE_SIGN_PAGE_PATH and CORPORATE_AGREEMENTS_PAGE_PATH in the shared contract
// (TanStack spells a parameter `$name`; router.test.tsx holds the two spellings together).

/** GitHub's id of a repository in an address: digits only, no leading zero, small enough to be an exact number. */
const REPOSITORY_ID_IN_PATH = /^[1-9]\d{0,14}$/u;

const corporateSignRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/corporate/sign/$githubRepoId',
  ...withAccess('authenticated', { title: 'corporate.sign.title' }),
  component: function CorporateSignRoute() {
    const { githubRepoId } = corporateSignRoute.useParams();
    return REPOSITORY_ID_IN_PATH.test(githubRepoId) ? (
      <CorporateSignPage githubRepoId={Number(githubRepoId)} />
    ) : (
      <NotFoundPage />
    );
  },
});

/** `?cursor=` of the list: the opaque cursor of the page on screen, else the first page. The raw value goes no further. */
const corporateAgreementsSearch = z.object({ cursor: z.string().max(512).optional().catch(undefined) });

const corporateAgreementsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/corporate/agreements',
  ...withAccess('authenticated', { title: 'corporate.agreements.title' }),
  validateSearch: corporateAgreementsSearch,
  component: function CorporateAgreementsRoute() {
    const { cursor } = corporateAgreementsRoute.useSearch();
    const navigate = corporateAgreementsRoute.useNavigate();
    return (
      <CorporateAgreementsPage
        cursor={cursor}
        onCursorChange={(next) => {
          void navigate({ search: { cursor: next } });
        }}
      />
    );
  },
});

// type-coverage:ignore-next-line -- TanStack Router's route tree type holds any in its own definition (RouteWithChildren)
const routeTree = rootRoute.addChildren([
  landingRoute,
  loginFailedRoute,
  setupRoute,
  setupCallbackRoute,
  repositorySettingsRoute,
  corporateSignRoute,
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
