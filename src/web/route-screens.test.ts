// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { ROUTES_WITHOUT_SCREEN, SCREENS } from '../../e2e/support/screens.ts';
import { createQueryClient } from './api/index.ts';
import { createAppRouter } from './router.tsx';
import { type RouteNode, routeFixtureProblems } from './test-support/routes.ts';

// E18-S12: the browser specs (e2e/axe.spec.ts, e2e/screens.visual.spec.ts) look at every screen in `SCREENS`. This guard holds that
// list against the route tree, so a route added later has a screen, or a written reason for having none, the day it lands.

/** The route tree of a router made for a fresh query client. */
function routeTree(): RouteNode {
  // type-coverage:ignore-next-line -- the router type is made from the route tree, which holds any
  return createAppRouter(createQueryClient()).routeTree;
}

test('every route of the tree has a screen or a reason for having none, and each one named here is a route of the tree', () => {
  const named = [...new Set([...SCREENS.map((screen) => screen.route), ...ROUTES_WITHOUT_SCREEN.keys()])];
  expect(routeFixtureProblems(routeTree(), named)).toEqual([]);
});

test('a route with a reason for having no screen has none', () => {
  const screens = new Set(SCREENS.map((screen) => screen.route));
  expect([...ROUTES_WITHOUT_SCREEN.keys()].filter((route) => screens.has(route))).toEqual([]);
});

test('the reasons are sentences, so a reader learns why the route is not in the browser specs', () => {
  for (const reason of ROUTES_WITHOUT_SCREEN.values()) {
    expect(reason.length).toBeGreaterThan(40);
  }
});

test('the screens are told apart by their ids, which name a baseline file: letters, digits and hyphens only', () => {
  const ids = SCREENS.map((screen) => screen.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.filter((id) => !/^[a-z][a-z0-9-]*$/.test(id))).toEqual([]);
});

test('a screen is opened by an absolute path, and the visitor is the one viewer who is not logged in', () => {
  expect(SCREENS.filter((screen) => !screen.path.startsWith('/'))).toEqual([]);
  expect(SCREENS.filter((screen) => screen.viewer === 'visitor').map((screen) => screen.id)).toEqual([
    'landing-visitor',
    'login-failed',
    'sign-login',
  ]);
});
