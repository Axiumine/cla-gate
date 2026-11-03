// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useQueryClient } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import type { PlainMessageKey } from '../i18n/index.ts';
import { AppShell } from '../layout/AppShell.tsx';
import { type Access, type RouterContext, withAccess } from '../route-access.ts';
import { NotFoundPage, RouterErrorComponent } from '../states/index.ts';

// The shell of the app with pages of a test's own (E17-S08, E17-S09), over memory history: what the guard, the banner, the
// user menu and the shell do is tested here with routes the app does not have (an `authenticated` one, one with a header
// slot) before E18 adds the real ones.

interface AppPage {
  readonly path: string;
  readonly access: Access;
  readonly component: () => ReactNode;
  /** The catalog key of the page title; `landing.title` when absent. */
  readonly title?: PlainMessageKey;
  /** The element the route supplies for the header. */
  readonly headerSlot?: ReactNode;
}

export interface TestAppRoutesProps {
  /** Where the router starts: a path with its query string. */
  readonly route: string;
  readonly pages: readonly AppPage[];
}

/** The page options of a test page: the title it names, and the header slot when it supplies one. */
function pageOptions(page: AppPage) {
  return {
    title: page.title ?? 'landing.title',
    ...(page.headerSlot === undefined ? {} : { headerSlot: page.headerSlot }),
  } as const;
}

function buildRouter(queryClient: RouterContext['queryClient'], { route, pages }: TestAppRoutesProps) {
  const root = createRootRouteWithContext<RouterContext>()({
    ...withAccess('public', { title: 'states.notFound.title' }),
    notFoundComponent: NotFoundPage,
    errorComponent: RouterErrorComponent,
  });
  const children = pages.map((page) =>
    createRoute({
      getParentRoute: () => root,
      path: page.path,
      component: page.component,
      ...(page.access === 'public'
        ? withAccess('public', pageOptions(page))
        : withAccess('authenticated', pageOptions(page))),
    }),
  );
  return createRouter({
    // type-coverage:ignore-next-line -- TanStack Router's route tree type holds any in its own definition (RouteWithChildren)
    routeTree: root.addChildren(children),
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [route] }),
    InnerWrap: AppShell,
  });
}

/** The shell of the app and `pages`, rendered the way the app renders its router. It is built once per mount. */
export function TestAppRoutes(props: TestAppRoutesProps) {
  const queryClient = useQueryClient();
  // type-coverage:ignore-next-line -- the router type is made from the route tree above, which holds any
  const [router] = useState(() => buildRouter(queryClient, props));
  // type-coverage:ignore-next-line -- the router type is made from the route tree above, which holds any
  return <RouterProvider router={router} />;
}
