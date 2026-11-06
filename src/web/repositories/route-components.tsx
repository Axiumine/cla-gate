// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { getRouteApi } from '@tanstack/react-router';
import { RepositoriesPage } from './RepositoriesPage.tsx';

// The component of the repositories route (E18-S10): it reads the installation and the search from its own route, by route id, so the
// route tree does not have to import it back (`getRouteApi` is typed from the registered tree).

// type-coverage:ignore-next-line -- the route API type is made from the route tree, which holds any
const repositoriesApi = getRouteApi('/installations/$installationId/repositories');

/** The route `/installations/$installationId/repositories?q=&enabled=&cursor=`: the repositories of the tenant, in the search of the address. */
export function RepositoriesRoute() {
  // type-coverage:ignore-next-line -- the route API type is made from the route tree, which holds any
  const { installationId } = repositoriesApi.useParams();
  // type-coverage:ignore-next-line -- the route API type is made from the route tree, which holds any
  const { q, enabled, cursor } = repositoriesApi.useSearch();
  // type-coverage:ignore-next-line -- the route API type is made from the route tree, which holds any
  const navigate = repositoriesApi.useNavigate();
  return (
    <RepositoriesPage
      installationId={installationId}
      filters={{ q, enabled }}
      cursor={cursor}
      onFiltersChange={(filters) => {
        void navigate({ search: { q: filters.q, enabled: filters.enabled } });
      }}
      onCursorChange={(next) => {
        void navigate({ search: (previous) => ({ ...previous, cursor: next }) });
      }}
      onFirstPage={() => {
        void navigate({ search: (previous) => ({ ...previous, cursor: undefined }), replace: true });
      }}
    />
  );
}
