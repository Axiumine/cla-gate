// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { expect, test } from 'vitest';
import { requireSession } from './auth/guard.ts';
import { withAccess } from './route-access.ts';

// E17-S08: a route says who may see it. There is no default, and a route that needs a login is guarded.

test('a public route declares public and has no guard', () => {
  expect(withAccess('public')).toEqual({ staticData: { access: 'public' } });
});

test('an authenticated route declares authenticated and gets the session guard', () => {
  const options = withAccess('authenticated');
  expect(options.staticData).toEqual({ access: 'authenticated' });
  expect(options.beforeLoad).toBe(requireSession);
});

test('the access has no default: a call without it does not compile, and if one gets through at run time the route is guarded', () => {
  // @ts-expect-error -- the argument is required; that this call does not compile is what the test shows
  const options = withAccess();
  expect(options).toHaveProperty('beforeLoad', requireSession);
});

test('the augmentation makes staticData a required option of a route, and its access one of the two words', () => {
  const root = createRootRoute({ staticData: { access: 'public' } });
  // @ts-expect-error -- a route without staticData must not compile: that is what the augmentation of StaticDataRouteOption is for
  const without = createRoute({ getParentRoute: () => root, path: '/without' });
  // @ts-expect-error -- an access that is neither public nor authenticated must not compile
  const unknown = createRoute({ getParentRoute: () => root, path: '/unknown', staticData: { access: 'maybe' } });
  expect([without.options.getParentRoute(), unknown.options.getParentRoute()]).toEqual([root, root]);
});
