// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { WEBHOOK_PATH } from '../../../shared/routes.ts';
import type { TenantResolver } from './tenant-access.ts';

// Who may call a route (E11-S01). Every route says so in `config.access`, and an app with a route that does not cannot
// start: this file records the route table, checks it once all plugins are loaded and names every offender. The guard that
// acts on the declarations at request time is in route-access-guard.ts; the decision table for tenant roles is the pure
// `decide` of src/server/domain/authz.ts.

/**
 * The kinds of access, as the `kind` of a declaration: `public` (no session needed, a closed list), `authenticated` (any
 * signed-in GitHub user, no tenant), `webhook` (the HMAC route, which has no session), `operator` (the instance operator,
 * E11-S08) and `tenant` (acts inside one installation, decided by the role of the viewer there, E11-S05).
 */
const ACCESS_KINDS = ['public', 'authenticated', 'webhook', 'operator', 'tenant'] as const;

/**
 * What a tenant route does: `read` may use the cached role, `write` always asks GitHub again (E11-S04). A route that
 * changes data (`POST`, `PUT`, `PATCH`, `DELETE`) is always `write`.
 */
const ACCESS_MODES = ['read', 'write'] as const;

/** A route of the `tenant` kind: the value `tenantAccess` of E11-S05 builds, which names its mode and the resolver of the tenant. */
const tenantAccessSchema = z.object({
  kind: z.literal('tenant'),
  mode: z.enum(ACCESS_MODES),
  resolve: z.custom<TenantResolver>((value) => typeof value === 'function'),
});

const accessSchema = z.union([z.enum(['public', 'authenticated', 'webhook', 'operator']), tenantAccessSchema]);

type RouteAccess = z.infer<typeof accessSchema>;

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Who may call the route (E11-S01): one of {@link ACCESS_KINDS}; a `tenant` route declares `tenantAccess({ mode, resolve })` (E11-S05). */
    access?: RouteAccess;
  }

  interface FastifyInstance {
    /** Every route registered on the app with what it declared (E11-S01), one entry per method. */
    routeAccess: readonly RouteAccessEntry[];
  }
}

/** One method of one route as the table records it: `access` is exactly what the route declared, valid or not. */
interface RouteAccessEntry {
  readonly method: string;
  readonly url: string;
  readonly access: unknown;
}

/**
 * The routes that may be `public` (`METHOD path`): nobody is asked who they are. A closed list: a new public route is a
 * reviewed edit of this constant, and the route-table test pins it. E17 (the static page handler and `GET /api/meta`) and
 * E19 (the setup routes, registered in setup mode only) add theirs in their own change, each with a changed test.
 * @internal Exported for the route-table test (Knip ignores `@internal` exports in production mode).
 */
export const PUBLIC_ROUTES: readonly string[] = [
  'GET /healthz',
  'GET /readyz',
  'GET /api/auth/login',
  'GET /api/auth/callback',
];

/**
 * The one route that may be `webhook`: GitHub's delivery, which authenticates by its HMAC and not by a session.
 * @internal Exported for the route-table test (Knip ignores `@internal` exports in production mode).
 */
export const WEBHOOK_ROUTES: readonly string[] = [`POST ${WEBHOOK_PATH}`];

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * The path parameters that name a tenant resource: a route with one of them is a tenant route, never `authenticated`,
 * `operator` (who sees the list of installations and nothing inside one, E11-S08) or `public`. `:githubRepoId` is not one
 * (the resolver of E11-S05 reads it).
 */
const TENANT_PARAMETER = /:(installationId|repositoryId|documentId|signatureId|entryId)(?!\w)/i;

function isTenantDeclaration(access: unknown): boolean {
  return (
    access === 'tenant' ||
    (typeof access === 'object' && access !== null && 'kind' in access && access.kind === 'tenant')
  );
}

/** What is wrong with a value that is not a declaration (or is missing). */
function malformedProblem(name: string, access: unknown): string {
  if (access === undefined) {
    return `route ${name} declares no config.access`;
  }
  return isTenantDeclaration(access)
    ? `route ${name} is a tenant route and must declare its mode, 'read' or 'write', and its resolver (tenantAccess)`
    : `route ${name} declares a config.access that is not one of ${ACCESS_KINDS.join(', ')}`;
}

/** The kinds of route that have no tenant: a tenant parameter in the path of one of them is a tenant route that forgot its guard. */
const TENANTLESS_KINDS: readonly string[] = ['authenticated', 'operator', 'public'];

/** What is wrong with a declaration that is well formed, for the one route `method url`. */
function kindProblem(method: string, url: string, access: RouteAccess): string | undefined {
  const name = `${method} ${url}`;
  if (access === 'webhook') {
    return WEBHOOK_ROUTES.includes(name)
      ? undefined
      : `route ${name} declares config.access 'webhook' but is not in WEBHOOK_ROUTES`;
  }
  if (typeof access === 'string' && TENANTLESS_KINDS.includes(access)) {
    const parameter = TENANT_PARAMETER.exec(url)?.[0];
    return parameter === undefined
      ? undefined
      : `route ${name} is ${access} but its path has the tenant parameter ${parameter}; declare it as a tenant route`;
  }
  return typeof access === 'object' && access.mode === 'read' && MUTATING_METHODS.has(method)
    ? `route ${name} is a tenant route that changes data, so its mode must be 'write'`
    : undefined;
}

/**
 * What is wrong with the access declaration of one route, or `undefined` when nothing is. `access` is `unknown` on purpose:
 * a value that slipped past the types (`'admin'`, a tenant route with no mode) is caught here. A route may be
 * `webhook` only when it is on {@link WEBHOOK_ROUTES}, may not be `authenticated`, `operator` or `public` when its path
 * has a tenant parameter, and a `tenant` route that changes data must be `write`.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export function accessProblem(method: string, url: string, access: unknown): string | undefined {
  const declared = accessSchema.safeParse(access);
  return declared.success ? kindProblem(method, url, declared.data) : malformedProblem(`${method} ${url}`, access);
}

/**
 * The access declaration of a route as it is used at request time, or `undefined` for a value that is not a declaration.
 * The same parsing the registration check uses, so what is checked is what is acted on.
 */
export function declaredAccess(access: unknown): RouteAccess | undefined {
  return accessSchema.safeParse(access).data;
}

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
