// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  accessById,
  allRoutes,
  type RouteNode,
  routeAccessProblems,
  routeFixtureProblems,
  routeTitleProblems,
} from './routes.ts';

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

const catalog = { 'landing.title': 'Home' };

test('a route is a problem when its title is missing, is not text, or is not a key of the catalog', () => {
  const titles: RouteNode = {
    id: '__root__',
    options: { staticData: { title: 'landing.title' } },
    children: [
      { id: '/ok', options: { staticData: { title: 'landing.title' } } },
      { id: '/missing', options: { staticData: {} } },
      { id: '/number', options: { staticData: { title: 7 } } },
      { id: '/unknown', options: { staticData: { title: 'no.such.key' } } },
      { id: '/inherited', options: { staticData: { title: 'toString' } } },
    ],
  };
  expect(routeTitleProblems(titles, catalog)).toEqual([
    '/missing: no catalog title declared',
    '/number: no catalog title declared',
    '/unknown: no catalog title declared',
    '/inherited: no catalog title declared',
  ]);
});

// E18-S09: the route coverage guard fails on a route that has no fixture, and on a fixture that has no route.

test('a table that lists exactly the routes of the tree has no problem', () => {
  expect(routeFixtureProblems(tree, ['__root__', '/a', '/b', '/b/c'])).toEqual([]);
});

test('a route added to the tree without a fixture is a problem naming it', () => {
  expect(routeFixtureProblems(tree, ['__root__', '/a', '/b'])).toEqual([
    '/b/c: no fixture in the route coverage table',
  ]);
});

test('a fixture whose route has gone is a problem naming it', () => {
  expect(routeFixtureProblems(tree, ['__root__', '/a', '/b', '/b/c', '/gone'])).toEqual([
    '/gone: a fixture for a route that is not in the tree',
  ]);
});

test('every missing route and every stale fixture is named at once, routes first', () => {
  expect(routeFixtureProblems(tree, ['/b', '/old'])).toEqual([
    '__root__: no fixture in the route coverage table',
    '/a: no fixture in the route coverage table',
    '/b/c: no fixture in the route coverage table',
    '/old: a fixture for a route that is not in the tree',
  ]);
});
