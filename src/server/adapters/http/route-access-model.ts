// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { WEBHOOK_PATH } from '../../../shared/routes.ts';
import type { TenantResolver } from './tenant-access.ts';

// What a route may declare as `config.access` (E11-S01): the kinds, the schema that tells a declaration from anything else,
// the closed lists of the routes that may be `public` and `webhook`, and the route table's entry. What is wrong with a
// declaration is in route-access-problems.ts, and the table and the start-up check are in route-access.ts.

/**
 * The kinds of access, as the `kind` of a declaration: `public` (no session needed, a closed list), `authenticated` (any
 * signed-in GitHub user, no tenant), `webhook` (the HMAC route, which has no session), `operator` (the instance operator,
 * E11-S08) and `tenant` (acts inside one installation, decided by the role of the viewer there, E11-S05).
 */
export const ACCESS_KINDS = ['public', 'authenticated', 'webhook', 'operator', 'tenant'] as const;

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

export const accessSchema = z.union([z.enum(['public', 'authenticated', 'webhook', 'operator']), tenantAccessSchema]);

export type RouteAccess = z.infer<typeof accessSchema>;

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
export interface RouteAccessEntry {
  readonly method: string;
  readonly url: string;
  readonly access: unknown;
}

/**
 * The routes that may be `public` (`METHOD path`): nobody is asked who they are. A closed list: a new public route is a
 * reviewed edit of this constant, and the route-table test pins it. `GET /api/meta` and the file routes of the single-page
 * app (E17: `GET /*` and `HEAD /*`, one route that answers both) are in it, and so is the public signature check of a repository
 * that opted in (E22-S02: no session, no cookie, one yes-or-no answer), and so are the setup routes (E19-S06): the status
 * is registered always, the unlock, the manifest, the read of the session's CSRF token (E19-S07) and the conversion (E19-S11)
 * in setup mode only.
 * @internal Exported for the route-table test (Knip ignores `@internal` exports in production mode).
 */
export const PUBLIC_ROUTES: readonly string[] = [
  'GET /healthz',
  'GET /readyz',
  'GET /api/auth/login',
  'GET /api/auth/callback',
  'GET /api/meta',
  'GET /api/public/repos/:githubRepoId/signers/:login',
  'GET /api/setup/status',
  'POST /api/setup/unlock',
  'POST /api/setup/manifest',
  'GET /api/setup/session',
  'POST /api/setup/convert',
  'GET /*',
  'HEAD /*',
];

/**
 * The one route that may be `webhook`: GitHub's delivery, which authenticates by its HMAC and not by a session.
 */
export const WEBHOOK_ROUTES: readonly string[] = [`POST ${WEBHOOK_PATH}`];

/**
 * The access declaration of a route as it is used at request time, or `undefined` for a value that is not a declaration.
 * The same parsing the registration check uses, so what is checked is what is acted on.
 */
export function declaredAccess(access: unknown): RouteAccess | undefined {
  return accessSchema.safeParse(access).data;
}
