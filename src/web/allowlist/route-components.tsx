// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { getRouteApi } from '@tanstack/react-router';
import { AllowlistPage } from './AllowlistPage.tsx';

// The component of the allowlist route (E18-S06): it reads the installation and the scope from its own route, by route id, so the route
// tree does not have to import it back (`getRouteApi` is typed from the registered tree).

// type-coverage:ignore-next-line -- the route API type is made from the route tree, which holds any
const allowlistApi = getRouteApi('/installations/$installationId/allowlist');

/** The route `/installations/$installationId/allowlist?repository=`: the allowlist of the tenant, in the scope of the address. */
export function AllowlistRoute() {
  // type-coverage:ignore-next-line -- the route API type is made from the route tree, which holds any
  const { installationId } = allowlistApi.useParams();
  // type-coverage:ignore-next-line -- the route API type is made from the route tree, which holds any
  const { repository } = allowlistApi.useSearch();
  // type-coverage:ignore-next-line -- the route API type is made from the route tree, which holds any
  const navigate = allowlistApi.useNavigate();
  return (
    <AllowlistPage
      installationId={installationId}
      repositoryId={repository}
      onScopeChange={(repositoryId) => {
        void navigate({ search: repositoryId === undefined ? {} : { repository: repositoryId } });
      }}
    />
  );
}
