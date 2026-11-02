// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyInstance } from 'fastify';
import type { RouteAccessEntry } from './route-access-model.ts';
import { accessProblem } from './route-access-problems.ts';

// Who may call a route (E11-S01). Every route says so in `config.access`, and an app with a route that does not cannot
// start: this file records the route table, checks it once all plugins are loaded and names every offender. The kinds and
// the closed lists are in route-access-model.ts, what is wrong with a declaration in route-access-problems.ts. The guard
// that acts on the declarations at request time is in route-access-guard.ts; the decision table for tenant roles is the
// pure `decide` of src/server/domain/authz.ts.

/**
 * Thrown while the app becomes ready, so an app with a route that has no valid declaration cannot start. The message names
 * every offending `METHOD path`, one per line.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export class RouteAccessError extends Error {
  override readonly name = 'RouteAccessError';

  constructor(problems: readonly string[]) {
    super(`${problems.length} route(s) break the access declarations:\n${problems.join('\n')}`);
  }
}

/** The method list of a route as Fastify hands it over: one method or several, in any case. */
function methodsOf(method: string | readonly string[]): string[] {
  return [method].flat().map((name) => name.toUpperCase());
}

/**
 * Records every route registered after this call in `app.routeAccess` and, when the app becomes ready (all plugins are
 * loaded, so a route registered from any of them is in the table), throws {@link RouteAccessError} naming every route
 * whose declaration is missing or wrong. Call it before any route is registered: the hook covers the routes of every
 * plugin registered after it. The `HEAD` route that Fastify adds beside a `GET` route is the same route and is not a
 * second entry; a `HEAD` route registered on its own is.
 */
export function requireRouteAccess(app: FastifyInstance): void {
  const table: RouteAccessEntry[] = [];
  app.decorate('routeAccess', table);
  app.addHook('onRoute', (route) => {
    const access: unknown = route.config?.access;
    for (const method of methodsOf(route.method)) {
      const twin =
        method === 'HEAD' &&
        table.some((entry) => entry.method === 'GET' && entry.url === route.url && entry.access === access);
      if (!twin) {
        table.push({ method, url: route.url, access });
      }
    }
  });
  app.addHook('onReady', (done) => {
    const problems = table.flatMap((entry) => accessProblem(entry.method, entry.url, entry.access) ?? []);
    done(problems.length === 0 ? undefined : new RouteAccessError(problems));
  });
}
