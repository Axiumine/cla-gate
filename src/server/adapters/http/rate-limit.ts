// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import rateLimit, { type RateLimitOptions } from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import { WEBHOOK_PATH } from '../../../shared/routes.ts';
import type { TrustProxy } from '../../config/trust-proxy.ts';
import type { Clock } from '../../services/ports/clock.ts';
import { requireAuth } from './auth-request.ts';
import { AppError } from './errors.ts';
import { warnWhenProxyIsSuspected } from './trust-proxy-warning.ts';

// Rate limiting with a correct client address (E10-S08). The key of every budget is `request.ip`, which Fastify derives
// from `TRUST_PROXY` (E04-S03); nothing here reads `X-Forwarded-For` or `Forwarded`. The store is the plugin's in-memory
// LRU, right for one process (the instance runs as one).

/** Every budget lasts one minute. */
const WINDOW_MS = 60_000;

/**
 * The budget of each client address per minute: the global one, and the overrides of the login routes (E10-S08). A route
 * takes its override through {@link routeRateLimit}. `signatureExport` is the budget of each signed-in person for the
 * signature CSV (E16-S03), taken through {@link userRateLimit}.
 */
export const RATE_LIMITS = {
  global: 600,
  login: 20,
  callback: 20,
  logout: 20,
  session: 120,
  signatureExport: 6,
} as const;

/**
 * At most this many keys per store. The plugin's default (5000) applies to every route with an override unless the route
 * says otherwise, which is why {@link routeRateLimit} repeats it.
 */
const RATE_LIMIT_MAX_KEYS = 10_000;

/**
 * The `config.rateLimit` of a route with its own budget of `max` requests per minute per client address. A route that
 * keys on something else (E13 keys signing on the session user) spreads this and adds a `keyGenerator`.
 */
export function routeRateLimit(max: number): RateLimitOptions {
  return { max, timeWindow: WINDOW_MS, cache: RATE_LIMIT_MAX_KEYS };
}

/**
 * The `config.rateLimit` of a route with a budget of `max` requests per minute for each signed-in person, keyed on the
 * numeric GitHub id of the session and not on the client address (E16-S03): a person behind another address, or two people
 * behind one, keep a budget each. The check runs in the `preHandler`, after the guard of the route access, so a request the
 * guard refuses (no session, no role, another tenant's document) costs nobody a request of their budget.
 */
export function userRateLimit(max: number): RateLimitOptions {
  return {
    ...routeRateLimit(max),
    hook: 'preHandler',
    keyGenerator: (request) => `user:${requireAuth(request).user.githubId}`,
  };
}

/**
 * The routes that may set `config.rateLimit = false` (`METHOD path`). GitHub delivers webhooks from a few addresses, and
 * E06-S07 already throttles failed signatures only. A closed list: an addition is a reviewed edit with its own test.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const RATE_LIMIT_EXEMPT: readonly string[] = [`POST ${WEBHOOK_PATH}`];

/**
 * What is wrong with the rate-limit declaration of a route, or `undefined` when nothing is. A route may switch the limit
 * off (`config.rateLimit = false`) only when every method it answers is on {@link RATE_LIMIT_EXEMPT} with this very path.
 * A route with a budget of its own must not answer HEAD: the plugin gives each registered route a store of its own, so the
 * automatic HEAD twin of a GET route would double the budget (set `exposeHeadRoute: false` on the GET route). Any other
 * value is the plugin's business (an object overrides, anything else is refused by the plugin). `config` is `unknown` on
 * purpose: a value that slipped past the types is caught here.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export function rateLimitProblem(
  methods: string | readonly string[],
  url: string,
  config: unknown,
  exempt: readonly string[] = RATE_LIMIT_EXEMPT,
): string | undefined {
  const declared =
    typeof config === 'object' && config !== null && 'rateLimit' in config ? config.rateLimit : undefined;
  const list = [methods].flat().map((method) => method.toUpperCase());
  if (declared === false) {
    const outside = list.find((method) => !exempt.includes(`${method} ${url}`));
    return outside === undefined
      ? undefined
      : `route ${outside} ${url} sets config.rateLimit = false but is not in RATE_LIMIT_EXEMPT`;
  }
  return typeof declared === 'object' && declared !== null && list.includes('HEAD')
    ? `route HEAD ${url} has a rate limit of its own, which it would not share with its GET route: set exposeHeadRoute to false on the GET route`
    : undefined;
}

/**
 * Thrown while a route is being registered, so an app with a route outside the limit that is not on the list cannot start.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export class RateLimitRouteError extends Error {
  override readonly name = 'RateLimitRouteError';
}

interface RateLimitOptionsOfApp {
  /** `TRUST_PROXY`: while it is `false`, a request that names a proxy is a sign of a wrong setting. */
  readonly trustProxy: TrustProxy;
  readonly clock: Clock;
}

/**
 * Registers the registration check, the plugin (the global budget and the `429` in the standard error body) and the
 * warning for a misconfigured `TRUST_PROXY`, on `app` and everything registered after this call. A request that no route
 * answers is limited too, from an early hook: it has no route to carry the plugin's own hook. A route is limited by the
 * plugin's own `onRequest` hook, which runs before the session lookup (a `preValidation` hook), so a request over its
 * budget costs no query. A route that keys its budget on the caller (E13) sets `hook` to `'preHandler'` in its
 * `config.rateLimit`, which runs after the lookup. Call it before any route is registered and before the session hook.
 */
export async function registerRateLimit(app: FastifyInstance, options: RateLimitOptionsOfApp): Promise<void> {
  app.addHook('onRoute', (route) => {
    const problem = rateLimitProblem(route.method, route.url, route.config);
    if (problem !== undefined) {
      throw new RateLimitRouteError(problem);
    }
  });
  warnWhenProxyIsSuspected(app, options);
  await app.register(rateLimit, {
    max: RATE_LIMITS.global,
    timeWindow: WINDOW_MS,
    cache: RATE_LIMIT_MAX_KEYS,
    errorResponseBuilder: () => new AppError(429, 'too_many_requests'),
  });
  const limitUnmatched = app.rateLimit();
  app.addHook('onRequest', async (request, reply) => {
    if (request.is404) {
      await limitUnmatched.call(app, request, reply);
    }
  });
}
