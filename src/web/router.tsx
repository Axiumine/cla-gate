// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useQueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import { LOGIN_FAILED_PATH, loginFailureReasonSchema } from '../shared/auth.ts';
import { SETUP_CALLBACK_PATH, SETUP_PATH } from '../shared/routes.ts';
import { allowlistSearchSchema } from './allowlist/allowlist-search.ts';
import { AllowlistRoute } from './allowlist/route-components.tsx';
import { documentRouteParams } from './documents/document-params.ts';
import { DocumentRoute, DocumentsRoute } from './documents/route-components.tsx';
import { InstallationsPage } from './installations/InstallationsPage.tsx';
import { installationRouteParams } from './installations/installation-params.ts';
import { InstallationHomeRoute, InstallationRoute } from './installations/route-components.tsx';
import { tenantPage } from './installations/tenant-page.tsx';
import { AppShell } from './layout/AppShell.tsx';
import { MySignaturesPage } from './me/MySignaturesPage.tsx';
import { mySignaturesSearchSchema } from './me/signatures-search.ts';
import { LandingPage } from './pages/LandingPage.tsx';
import { LoginFailedPage } from './pages/LoginFailedPage.tsx';
import { pendingSearchSchema } from './pending/pending-search.ts';
import { PendingRoute } from './pending/route-components.tsx';
import { RepositorySettingsPage } from './repository-settings/RepositorySettingsPage.tsx';
import { type RouterContext, withAccess } from './route-access.ts';
import { SetupCallbackPage } from './setup/SetupCallbackPage.tsx';
import { SetupPage } from './setup/SetupPage.tsx';
import { parseGithubRepoId, signSearchSchema } from './sign/params.ts';
import { SignPage } from './sign/SignPage.tsx';
import { SignaturesRoute } from './signatures/route-components.tsx';
import { signaturesSearchSchema } from './signatures/signatures-search.ts';
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

// The person's own signatures (E18-S03): `authenticated`, so a visitor with no session is sent to the login before anything loads.
// The page of the list is the `cursor` of the address, so a reload and the browser's Back return to it; a page is a history entry.
const mySignaturesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/me/signatures',
  ...withAccess('authenticated', { title: 'me.signatures.title' }),
  validateSearch: mySignaturesSearchSchema,
  component: function MySignaturesRoute() {
    const navigate = mySignaturesRoute.useNavigate();
    return (
      <MySignaturesPage
        cursor={mySignaturesRoute.useSearch().cursor}
        onCursorChange={(cursor) => {
          void navigate({ search: { cursor } });
        }}
        onFirstPage={() => {
          void navigate({ search: {}, replace: true });
        }}
      />
    );
  },
});

// The installations the person administers (E18-S04): the tenants of this instance. `authenticated`, like every maintainer screen.
const installationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/installations',
  ...withAccess('authenticated', { title: 'installations.title' }),
  component: InstallationsPage,
});

// One tenant (E18-S04): `$installationId` is `installations.id`, the number the API gives, never GitHub's id. A segment that is
// not a plain positive number is no page of the app. The route is the frame of every screen below it (the suspended banner), and
// the screens that E18 adds are its children; each one hands the shell the tenant switcher (`tenantPage`).
const installationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/installations/$installationId',
  ...tenantPage('installation.title'),
  params: installationRouteParams,
  component: InstallationRoute,
});

const installationHomeRoute = createRoute({
  getParentRoute: () => installationRoute,
  path: '/',
  ...tenantPage('installation.title'),
  component: InstallationHomeRoute,
});

// The CLA documents of a tenant (E18-S05): the list, and one document with its editor. `$documentId` is `cla_documents.id`; a segment
// that is not a plain positive number is no page of the app. The list needs an org admin, a document the role of its scope: the
// server decides on every request.
const documentsRoute = createRoute({
  getParentRoute: () => installationRoute,
  path: 'documents',
  ...tenantPage('documents.title'),
  component: DocumentsRoute,
});

const documentRoute = createRoute({
  getParentRoute: () => installationRoute,
  path: 'documents/$documentId',
  ...tenantPage('document.title'),
  params: documentRouteParams,
  component: DocumentRoute,
});

// The allowlist of a tenant (E18-S06): the accounts exempt from signing, in the scope of `?repository=` (the whole installation without it). An
// org admin manages the whole installation and any repository, a repo admin the repositories they administer: the server decides on every request.
const allowlistRoute = createRoute({
  getParentRoute: () => installationRoute,
  path: 'allowlist',
  ...tenantPage('allowlist.title'),
  validateSearch: allowlistSearchSchema,
  component: AllowlistRoute,
});

// The signatures of a tenant (E18-S07): the search and the page of `?q=&state=&document=&cursor=`, so a filtered view is shared by its address.
// An org admin reads every document, a repo admin the documents of their repositories: the server decides on every request.
const signaturesRoute = createRoute({
  getParentRoute: () => installationRoute,
  path: 'signatures',
  ...tenantPage('signatures.title'),
  validateSearch: signaturesSearchSchema,
  component: SignaturesRoute,
});

// The pending pull requests and the commit overrides of a tenant (E18-S08): `?tab=&repository=&reason=&cursor=`, so a filtered view is shared by
// its address. Any role of the tenant opens it; the server decides which repositories a person may read and who may record or remove an
// override, on every request.
const pendingRoute = createRoute({
  getParentRoute: () => installationRoute,
  path: 'pending',
  ...tenantPage('pending.title'),
  validateSearch: pendingSearchSchema,
  component: PendingRoute,
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
  installationRoute.addChildren([
    installationHomeRoute,
    documentsRoute,
    documentRoute,
    allowlistRoute,
    signaturesRoute,
    pendingRoute,
  ]),
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
