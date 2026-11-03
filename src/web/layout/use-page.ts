// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useRouterState } from '@tanstack/react-router';
import { type ReactNode, useEffect } from 'react';
import { useT } from '../i18n/index.ts';

// What the shell reads of the page that is showing (E17-S09): the route that matched deepest says its title and, if it wants
// one, its header slot, in the `staticData` it declares (route-access.ts).

/**
 * The title of the page that is showing, from the catalog, or `undefined` before the first route has loaded. It also puts it
 * in `document.title` as "<page title> · CLA" (and the name of the app alone while there is none), so the tab, the history
 * and a screen reader's window list say where the person is.
 */
export function usePageTitle(): string | undefined {
  const t = useT();
  // type-coverage:ignore-next-line -- the router state type is made from the route tree, which holds any
  const key = useRouterState({ select: (state) => state.matches.at(-1)?.staticData.title });
  const title = key === undefined ? undefined : t(key);
  useEffect(() => {
    document.title = title === undefined ? t('app.name') : t('app.pageTitle', { title });
  }, [t, title]);
  return title;
}

/** The header slot of the page that is showing, or `undefined` when its route supplies none. */
export function useHeaderSlot(): ReactNode {
  // type-coverage:ignore-next-line -- the router state type is made from the route tree, which holds any
  return useRouterState({ select: (state) => state.matches.at(-1)?.staticData.headerSlot });
}
