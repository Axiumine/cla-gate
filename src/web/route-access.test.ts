// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { expect, test } from 'vitest';
import { requireSession } from './auth/guard.ts';
import { withAccess } from './route-access.ts';

// E17-S08: a route says who may see it. There is no default, and a route that needs a login is guarded.

test('a public route declares public and its page title, and has no guard', () => {
  expect(withAccess('public', { title: 'landing.title' })).toEqual({
    staticData: { access: 'public', title: 'landing.title' },
  });
});

const slot = 'the tenant switcher';

test('a route may supply a header slot, which is kept in its static data', () => {
  const options = withAccess('public', { title: 'landing.title', headerSlot: slot });
  expect(options.staticData).toEqual({ access: 'public', title: 'landing.title', headerSlot: slot });
});

test('an authenticated route declares authenticated and gets the session guard', () => {
  const options = withAccess('authenticated', { title: 'landing.title' });
  expect(options.staticData).toEqual({ access: 'authenticated', title: 'landing.title' });
  expect(options.beforeLoad).toBe(requireSession);
});

test('the access has no default: a call without it does not compile, and if one gets through at run time the route is guarded', () => {
  // @ts-expect-error -- the arguments are required; that this call does not compile is what the test shows
  const options = withAccess();
  expect(options).toHaveProperty('beforeLoad', requireSession);
});

test('the page title has no default either: a call without it does not compile', () => {
  // @ts-expect-error -- the page options are required; that this call does not compile is what the test shows
  const options = withAccess('public');
  expect(options).toHaveProperty('staticData.access', 'public');
});

test('the augmentation makes staticData a required option of a route, with an access of the two words and a catalog title', () => {
  const root = createRootRoute({ staticData: { access: 'public', title: 'app.name' } });
  // @ts-expect-error -- a route without staticData must not compile: that is what the augmentation of StaticDataRouteOption is for
  const without = createRoute({ getParentRoute: () => root, path: '/without' });
  const unknown = createRoute({
    getParentRoute: () => root,
    path: '/unknown',
    // @ts-expect-error -- an access that is neither public nor authenticated must not compile
    staticData: { access: 'maybe', title: 'app.name' },
  });
  // @ts-expect-error -- a route without a page title must not compile
  const untitled = createRoute({ getParentRoute: () => root, path: '/untitled', staticData: { access: 'public' } });
  const invented = createRoute({
    getParentRoute: () => root,
    path: '/invented',
    // @ts-expect-error -- a title that is not a catalog key must not compile
    staticData: { access: 'public', title: 'no.such.key' },
  });
  const needy = createRoute({
    getParentRoute: () => root,
    path: '/needy',
    // @ts-expect-error -- a title whose message needs parameters cannot be shown as it is and must not compile
    staticData: { access: 'public', title: 'app.pageTitle' },
  });
  const parents = [without, unknown, untitled, invented, needy].map((route) => route.options.getParentRoute());
  expect(parents).toEqual([root, root, root, root, root]);
});
