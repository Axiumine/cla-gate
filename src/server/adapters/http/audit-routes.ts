// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AUDIT_ACTIONS, type AuditAction } from '../../../shared/audit.ts';

/**
 * Why a mutating route under `/api` records no audit row of its own (E04-S09): `webhook` is the HMAC route, audited by
 * the lifecycle handlers it calls; `session` is the login callback and logout; `setup` is the first-run setup of the
 * App, which runs before any actor exists. A closed list: a new reason is a reviewed change to this constant.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const AUDIT_EXEMPT_REASONS = ['webhook', 'session', 'setup'] as const;

type AuditExemptReason = (typeof AUDIT_EXEMPT_REASONS)[number];

declare module 'fastify' {
  interface FastifyContextConfig {
    /** The audit action a mutating `/api` route records (E04-S09). */
    audit?: AuditAction;
    /** Set instead of `audit` for a mutating `/api` route that records nothing of its own, with the reason. */
    auditExempt?: AuditExemptReason;
  }
}

const routeConfig = z.object({
  audit: z.enum(AUDIT_ACTIONS).optional(),
  auditExempt: z.enum(AUDIT_EXEMPT_REASONS).optional(),
});

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * `/api` and everything below it, and also a route whose first segment is a wildcard or a parameter (`/*`, `/:tenant`),
 * because it would answer `/api/...` too. Fastify matches case-sensitively, but the guard does not rely on it.
 */
const API_ROUTE = /^(?:\/(?:api(?:\/|$)|[*:(])|\*)/i;

/**
 * What is wrong with the audit declaration of a route, or `undefined` when nothing is: every route under `/api` with a
 * mutating method needs exactly one of `config.audit` and `config.auditExempt`. `config` is `unknown` on purpose: a
 * value that slipped past the types (a made-up action, a reason outside the list) is caught here.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export function auditProblem(methods: string | readonly string[], url: string, config: unknown): string | undefined {
  const list = [methods].flat().map((method) => method.toUpperCase());
  if (!API_ROUTE.test(url) || !list.some((method) => MUTATING_METHODS.has(method))) {
    return undefined;
  }
  const name = `${list.join('|')} ${url}`;
  const declared = routeConfig.safeParse(config ?? {});
  if (!declared.success) {
    return `route ${name} declares a config.audit or config.auditExempt that is not in the closed list`;
  }
  const { audit, auditExempt } = declared.data;
  if (audit === undefined && auditExempt === undefined) {
    return `route ${name} must declare config.audit (an AUDIT_ACTIONS member) or config.auditExempt (a reason)`;
  }
  return audit !== undefined && auditExempt !== undefined
    ? `route ${name} declares both config.audit and config.auditExempt; declare one`
    : undefined;
}

/**
 * Thrown while a route is being registered, so an app with an unaudited mutation cannot start.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export class UnauditedRouteError extends Error {
  override readonly name = 'UnauditedRouteError';
}

/**
 * Makes registering a mutating `/api` route without `config.audit` or `config.auditExempt` throw, naming the route.
 * Call it before any route is registered: the hook covers the routes of every plugin registered after it.
 */
export function requireAuditedRoutes(app: FastifyInstance): void {
  app.addHook('onRoute', (route) => {
    const problem = auditProblem(route.method, route.url, route.config);
    if (problem !== undefined) {
      throw new UnauditedRouteError(problem);
    }
  });
}
