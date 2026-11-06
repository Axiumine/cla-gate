// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { createQueryClient } from './api/index.ts';
import { AppRouter, createAppRouter } from './router.tsx';
import { expectNoA11yViolations } from './test-support/a11y.ts';
import { renderWithProviders } from './test-support/render.tsx';
import { h1Count, positiveTabindexes, unreachableByTab } from './test-support/route-checks.ts';
import { ROUTE_FIXTURES } from './test-support/route-fixtures.ts';
import { type RouteNode, routeFixtureProblems } from './test-support/routes.ts';
import { ALICE } from './test-support/session.ts';

// E18-S09: the route coverage guard. Every route of the router tree has an entry in the table of fixtures (test-support/route-fixtures.ts),
// and every entry is rendered with its made-up server and checked: axe, no positive tabindex, one h1, and every interactive element
// reachable with the Tab key. A route added without a fixture fails the first test, so the screens of E18-S10 to E18-S14, and
// the ones after them, are covered the day they land.

/** The route tree of a router made for a fresh query client. */
function routeTree(): RouteNode {
  // type-coverage:ignore-next-line -- the router type is made from the route tree, which holds any
  return createAppRouter(createQueryClient()).routeTree;
}

test('every route of the tree has a fixture, and every fixture is a route of the tree: this test fails on the route that has none', () => {
  expect(routeFixtureProblems(routeTree(), [...ROUTE_FIXTURES.keys()])).toEqual([]);
});

test.each([...ROUTE_FIXTURES])(
  '%s is rendered, and is accessible, has one h1, has no positive tabindex, and every control takes Tab',
  async (_id, fixture) => {
    fixture.serve();
    const { container, user } = renderWithProviders(<AppRouter />, { route: fixture.address, session: ALICE });
    await fixture.ready();
    await expectNoA11yViolations(container);
    expect(h1Count(container)).toBe(1);
    expect(positiveTabindexes(container)).toEqual([]);
    expect(await unreachableByTab(user, container)).toEqual([]);
  },
);
