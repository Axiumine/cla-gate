// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { createRootRouteWithContext } from '@tanstack/react-router';
import { type RouterContext, withAccess } from './route-access.ts';
import { NotFoundPage, RouterErrorComponent } from './states/index.ts';

// The root of the route tree (E17-S08), in a file of its own so that the routes of a feature (corporate/corporate-routes.tsx) can name
// their parent without importing router.tsx, which imports them.

// The root is the deepest match only when no route matched, so its title is the not-found page's.
export const rootRoute = createRootRouteWithContext<RouterContext>()({
  ...withAccess('public', { title: 'states.notFound.title' }),
  notFoundComponent: NotFoundPage,
  errorComponent: RouterErrorComponent,
});
