// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { createRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { InstallationsPage } from './installations/InstallationsPage.tsx';
import { MySignaturesPage } from './me/MySignaturesPage.tsx';
import { mySignaturesSearchSchema } from './me/signatures-search.ts';
import { OperatorPage } from './operator/OperatorPage.tsx';
import { RepositorySettingsPage } from './repository-settings/RepositorySettingsPage.tsx';
import { rootRoute } from './root-route.ts';
import { withAccess } from './route-access.ts';

// The routes of a signed-in person that are not the screens of one tenant (E18-S03, E18-S04, E18-S13, E22-S03): the repository
// settings, the own signatures, the list of installations and the operator's list. All of them are `authenticated`. They are in a
// file of their own so that router.tsx, which builds the tree, stays under the complexity cap of the fta check.

/** A row id in an address: digits, no sign, no leading zero, at most 15 of them so that the number is always safe. */
const rowIdParam = z
  .string()
  .regex(/^[1-9]\d{0,14}$/)
  .transform(Number);

const repositorySettingsParams = z.object({ installationId: rowIdParam, repositoryId: rowIdParam });

// The settings screen of a repository (E22-S03), for a signed-in person; the server decides who may see and change what is on it.
// An address whose ids are not row ids matches no route, so it is the not-found page and never a call with a made-up id.
export const repositorySettingsRoute = createRoute({
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

// The person's own signatures (E18-S03): `authenticated`, so a visitor with no session is sent to the login before anything loads.
// The page of the list is the `cursor` of the address, so a reload and the browser's Back return to it; a page is a history entry.
export const mySignaturesRoute = createRoute({
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
export const installationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/installations',
  ...withAccess('authenticated', { title: 'installations.title' }),
  component: InstallationsPage,
});

// The installations of the instance (E18-S13), for its operator: `authenticated` like every screen behind a login; the server answers `404` to
// everyone who is not the operator, and the page is then the not-found page. The operator is no tenant role and opens no tenant.
export const operatorInstallationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/operator/installations',
  ...withAccess('authenticated', { title: 'operator.title' }),
  component: OperatorPage,
});
