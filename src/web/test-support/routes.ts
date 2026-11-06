// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// Reading a route tree in a test (E17-S08). The tree is walked through the same fields the router reads, typed as little as
// needed, so a route that E18 or E19 adds is found without anyone listing it here.

/** What a test needs to know of a route: its id, what its options declare, and its children. */
export interface RouteNode {
  readonly id: string;
  readonly options: {
    readonly staticData?: { readonly access?: unknown; readonly title?: unknown } | undefined;
  };
  readonly children?: unknown;
}

function isList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isRouteNode(value: unknown): value is RouteNode {
  return typeof value === 'object' && value !== null && 'id' in value && 'options' in value;
}

/** `root` and every route below it, depth first. */
export function allRoutes(root: RouteNode): RouteNode[] {
  const children = isList(root.children) ? root.children : [];
  return [root, ...children.filter(isRouteNode).flatMap(allRoutes)];
}

/** The routes that do not declare `staticData.access` as `public` or `authenticated`, one line each; none means all do. */
export function routeAccessProblems(root: RouteNode): string[] {
  return allRoutes(root).flatMap((route) => {
    const access = route.options.staticData?.access;
    return access === 'public' || access === 'authenticated' ? [] : [`${route.id}: no access declared`];
  });
}

/**
 * The routes whose `staticData.title` is not a key of `catalog`, one line each; none means every route names a page title
 * from the catalog (E17-S09).
 */
export function routeTitleProblems(root: RouteNode, catalog: Readonly<Record<string, string>>): string[] {
  return allRoutes(root).flatMap((route) => {
    const title = route.options.staticData?.title;
    return typeof title === 'string' && Object.hasOwn(catalog, title) ? [] : [`${route.id}: no catalog title declared`];
  });
}

/** The access every route declares, by id: `{ '/': 'public', ... }`. */
export function accessById(root: RouteNode): Record<string, unknown> {
  return Object.fromEntries(allRoutes(root).map((route) => [route.id, route.options.staticData?.access]));
}

/**
 * The route coverage guard's check on its own table (E18-S09), one line for each problem; none means the table of fixtures and the
 * route tree list the same routes. A route with no fixture is a screen nobody renders in the guard, and a fixture with no route is a
 * screen that has gone or been renamed, so both fail.
 */
export function routeFixtureProblems(root: RouteNode, fixtureIds: readonly string[]): string[] {
  const fixtures = new Set(fixtureIds);
  const routes = allRoutes(root).map((route) => route.id);
  return [
    ...routes.filter((id) => !fixtures.has(id)).map((id) => `${id}: no fixture in the route coverage table`),
    ...[...fixtures]
      .filter((id) => !routes.includes(id))
      .map((id) => `${id}: a fixture for a route that is not in the tree`),
  ];
}
