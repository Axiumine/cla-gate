// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { getRouteApi } from '@tanstack/react-router';
import { TenantLayout } from './TenantLayout.tsx';
import { TenantOverview } from './TenantOverview.tsx';

// The components of the routes below an installation (E18-S04): each reads the installation of its address from its own route,
// by id, so the route tree does not have to import them back (`getRouteApi` is typed from the registered tree).

// type-coverage:ignore-next-line -- the route API type is made from the route tree, which holds any
const installation = getRouteApi('/installations/$installationId');
// type-coverage:ignore-next-line -- the route API type is made from the route tree, which holds any
const overview = getRouteApi('/installations/$installationId/');

/** The route `/installations/$installationId`: the frame of the screens below it. */
export function InstallationRoute() {
  // type-coverage:ignore-next-line -- the route API type is made from the route tree, which holds any
  return <TenantLayout installationId={installation.useParams().installationId} />;
}

/** The route `/installations/$installationId` itself, its index: the overview of the tenant. */
export function InstallationHomeRoute() {
  // type-coverage:ignore-next-line -- the route API type is made from the route tree, which holds any
  return <TenantOverview installationId={overview.useParams().installationId} />;
}
