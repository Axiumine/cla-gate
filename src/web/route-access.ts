// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { QueryClient } from '@tanstack/react-query';
import { requireSession } from './auth/guard.ts';

// Who may see a route (E17-S08). Every route says it, there is no default, and a route that needs a login is guarded before
// it loads.

/** `public` is for anyone, with or without a session; `authenticated` needs a login and sends everyone else to it. */
export type Access = 'public' | 'authenticated';

declare module '@tanstack/react-router' {
  // Declaring a member here makes `staticData` a required option of every route: a route without it does not compile.
  interface StaticDataRouteOption {
    readonly access: Access;
  }
}

/** What every route can read from the router's context (E17-S08). */
export interface RouterContext {
  readonly queryClient: QueryClient;
}

/**
 * The route-access options for `createRoute`, to be spread into its options: `createRoute({ ..., ...withAccess('public') })`.
 * The argument has no default, so a route cannot be declared without a decision. An `authenticated` route also gets the
 * guard that sends a visitor without a session to the login before the route loads.
 */
export function withAccess(access: 'public'): { readonly staticData: { readonly access: 'public' } };
export function withAccess(access: 'authenticated'): {
  readonly staticData: { readonly access: 'authenticated' };
  readonly beforeLoad: typeof requireSession;
};
export function withAccess(access: Access) {
  return access === 'public' ? { staticData: { access } } : { staticData: { access }, beforeLoad: requireSession };
}
