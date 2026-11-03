// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { requireSession } from './auth/guard.ts';
import type { PlainMessageKey } from './i18n/index.ts';

// Who may see a route (E17-S08) and what the shell shows for it (E17-S09). Every route says who may see it, there is no
// default, and a route that needs a login is guarded before it loads. Every route also names its page title, and may supply
// a header slot.

/** `public` is for anyone, with or without a session; `authenticated` needs a login and sends everyone else to it. */
export type Access = 'public' | 'authenticated';

declare module '@tanstack/react-router' {
  // Declaring a member here makes `staticData` a required option of every route: a route without it does not compile.
  interface StaticDataRouteOption {
    readonly access: Access;
    /** The catalog key of the page title: `document.title` is "<title> · CLA", and a live region announces it on navigation (E17-S09). */
    readonly title: PlainMessageKey;
    /** An element the shell renders in the header while this route is the page, made once where the route is declared (E18 puts the tenant switcher there). */
    readonly headerSlot?: ReactNode;
  }
}

/** What every route can read from the router's context (E17-S08). */
export interface RouterContext {
  readonly queryClient: QueryClient;
}

/** What a route says about its page besides who may see it (E17-S09). */
export interface PageOptions {
  readonly title: PlainMessageKey;
  readonly headerSlot?: ReactNode;
}

/**
 * The route options for `createRoute`, to be spread into its options: `createRoute({ ..., ...withAccess('public', { title })
 * })`. The access has no default, so a route cannot be declared without a decision; the page title is required too. An
 * `authenticated` route also gets the guard that sends a visitor without a session to the login before the route loads.
 */
export function withAccess(
  access: 'public',
  page: PageOptions,
): { readonly staticData: { readonly access: 'public' } & PageOptions };
export function withAccess(
  access: 'authenticated',
  page: PageOptions,
): {
  readonly staticData: { readonly access: 'authenticated' } & PageOptions;
  readonly beforeLoad: typeof requireSession;
};
export function withAccess(access: Access, page: PageOptions) {
  const staticData = { access, ...page };
  return access === 'public' ? { staticData } : { staticData, beforeLoad: requireSession };
}
