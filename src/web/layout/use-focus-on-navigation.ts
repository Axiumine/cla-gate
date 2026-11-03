// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useRouter } from '@tanstack/react-router';
import { type RefObject, useEffect } from 'react';

// Moving focus when the page changes (E17-S09). A client-side navigation replaces the page without the browser's own
// "new page" cue, so a keyboard or screen reader user would be left on a link that is no longer there.

/**
 * Where focus goes when a new page has rendered: its `<h1>`, or the `<main>` landmark when it has none. Neither is in the tab
 * order by itself, so the heading is given `tabindex="-1"`, which lets a script focus it and puts nothing in the tab order.
 */
function focusStartOfPage(main: HTMLElement): void {
  const target = main.querySelector('h1') ?? main;
  if (!target.hasAttribute('tabindex')) {
    target.setAttribute('tabindex', '-1');
  }
  target.focus();
}

/**
 * Focuses the start of the page after every navigation that changes the path, once the new page has rendered. The first
 * load is not a navigation: focus stays where the browser puts it, so the first Tab reaches the "Skip to content" link. A
 * change of the search or the hash alone (a page of a table, a tab) leaves focus where it is.
 */
export function useFocusOnNavigation(main: RefObject<HTMLElement | null>): void {
  // type-coverage:ignore-next-line -- the router type is made from the route tree, which holds any (TanStack Router's RouteWithChildren)
  const router = useRouter();
  useEffect(
    () =>
      // type-coverage:ignore-next-line -- the router type is made from the route tree, which holds any
      router.subscribe('onRendered', ({ pathChanged, fromLocation }) => {
        const element = main.current;
        // The first load has no location to come from: it is not a navigation.
        if (pathChanged && fromLocation !== undefined && element !== null) {
          focusStartOfPage(element);
        }
      }),
    [router, main],
  );
}
