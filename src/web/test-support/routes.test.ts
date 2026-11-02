// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { accessById, allRoutes, type RouteNode, routeAccessProblems } from './routes.ts';

const tree: RouteNode = {
  id: '__root__',
  options: { staticData: { access: 'public' } },
  children: [
    { id: '/a', options: { staticData: { access: 'authenticated' } } },
    { id: '/b', options: { staticData: { access: 'maybe' } }, children: [{ id: '/b/c', options: {} }] },
    'not a route',
    null,
  ],
};

test('allRoutes lists the root and every route below it, depth first, and skips what is no route', () => {
  expect(allRoutes(tree).map((route) => route.id)).toEqual(['__root__', '/a', '/b', '/b/c']);
});

test('a route is a problem when its access is missing or is neither public nor authenticated', () => {
  expect(routeAccessProblems(tree)).toEqual(['/b: no access declared', '/b/c: no access declared']);
});

test('a tree whose routes all declare an access has no problem', () => {
  const sound: RouteNode = { id: '__root__', options: { staticData: { access: 'public' } }, children: [] };
  expect(routeAccessProblems(sound)).toEqual([]);
});

test('a root without a children list is a tree of one route', () => {
  expect(allRoutes({ id: 'only', options: {} }).map((route) => route.id)).toEqual(['only']);
});

test('accessById maps each route to what it declared', () => {
  expect(accessById(tree)).toEqual({ __root__: 'public', '/a': 'authenticated', '/b': 'maybe', '/b/c': undefined });
});
