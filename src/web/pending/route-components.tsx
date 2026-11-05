// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { getRouteApi } from '@tanstack/react-router';
import { PendingPage } from './PendingPage.tsx';

// The component of the pending route (E18-S08): it reads the installation and the search from its own route, by route id, so the route
// tree does not have to import it back (`getRouteApi` is typed from the registered tree).

// type-coverage:ignore-next-line -- the route API type is made from the route tree, which holds any
const pendingApi = getRouteApi('/installations/$installationId/pending');

/** The route `/installations/$installationId/pending?tab=&repository=&reason=&cursor=`: the pending pull requests and the overrides of the tenant. */
export function PendingRoute() {
  // type-coverage:ignore-next-line -- the route API type is made from the route tree, which holds any
  const { installationId } = pendingApi.useParams();
  // type-coverage:ignore-next-line -- the route API type is made from the route tree, which holds any
  const search = pendingApi.useSearch();
  // type-coverage:ignore-next-line -- the route API type is made from the route tree, which holds any
  const navigate = pendingApi.useNavigate();
  return (
    <PendingPage
      installationId={installationId}
      search={search}
      onTabChange={(tab) => {
        void navigate({ search: tab === 'overrides' ? { tab } : {} });
      }}
      onFiltersChange={({ repository, reason }) => {
        void navigate({ search: (previous) => ({ tab: previous.tab, repository, reason }) });
      }}
      onCursorChange={(cursor) => {
        void navigate({ search: (previous) => ({ ...previous, cursor }) });
      }}
      onFirstPage={() => {
        void navigate({ search: (previous) => ({ ...previous, cursor: undefined }), replace: true });
      }}
    />
  );
}
