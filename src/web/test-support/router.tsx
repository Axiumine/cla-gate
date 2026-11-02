// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  type ErrorRouteComponent,
  type NotFoundRouteComponent,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';

// A small router for the tests of the components that live inside one (E17-S07): the error component and the not-found
// component are the router's own hooks, so they are tested in a router. E17-S08 builds the real route tree.

interface TestPage {
  readonly path: string;
  readonly component: () => ReactNode;
  /** Runs before the route renders; a throw is the route's error. */
  readonly loader?: () => unknown;
}

export interface TestRoutesProps {
  /** Where the router starts. */
  readonly route: string;
  readonly pages: readonly TestPage[];
  readonly errorComponent?: ErrorRouteComponent;
  readonly notFoundComponent?: NotFoundRouteComponent;
}

function buildRouter({ route, pages, errorComponent, notFoundComponent }: TestRoutesProps) {
  const root = createRootRoute({
    staticData: { access: 'public', title: 'app.name' },
    component: Outlet,
    ...(errorComponent === undefined ? {} : { errorComponent }),
    ...(notFoundComponent === undefined ? {} : { notFoundComponent }),
  });
  const children = pages.map((page) =>
    createRoute({
      getParentRoute: () => root,
      path: page.path,
      staticData: { access: 'public', title: 'app.name' },
      component: page.component,
      ...(page.loader === undefined ? {} : { loader: page.loader }),
    }),
  );
  return createRouter({
    // type-coverage:ignore-next-line -- TanStack Router's route tree type holds any in its own definition (RouteWithChildren)
    routeTree: root.addChildren(children),
    history: createMemoryHistory({ initialEntries: [route] }),
  });
}

/** A router over memory history with the given pages, rendered the way the app renders its router. It is built once per mount. */
export function TestRoutes(props: TestRoutesProps) {
  // type-coverage:ignore-next-line -- the router type is made from the route tree above, which holds any
  const [router] = useState(() => buildRouter(props));
  // type-coverage:ignore-next-line -- the router type is made from the route tree above, which holds any
  return <RouterProvider router={router} />;
}
