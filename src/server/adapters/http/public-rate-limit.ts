// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from './errors.ts';
import { routeRateLimit } from './rate-limit.ts';

// The two budgets of the public routes (E22-S02), checked by the rate-limit plugin's own limiter and shared by every route that
// uses the hook: 30 requests a minute for each client address and 600 for each repository, whoever asks. The address is
// `request.ip`, which Fastify derives from `TRUST_PROXY` (E04-S03), and nothing here reads `X-Forwarded-For`. The stores are the
// plugin's in-memory LRU (a minute, at most 10,000 keys each), right for one process: the instance runs as one. The two limiters are made once, so
// a route added later (the badges of E22-S03) draws on the same buckets and not on a pair of its own.

/**
 * The requests a minute a client address and a repository may make of the public routes.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const PUBLIC_RATE_LIMITS = { perClient: 30, perRepository: 600 } as const;

/** A repository id as the path spells it: plain digits, as the route reads one. */
const REPOSITORY_ID = /^[1-9]\d{0,15}$/;

/**
 * The key of the repository's bucket: the id from the path when it is spelled as a repository id, else one shared key for every
 * spelling that is not (those requests are refused as invalid input, and a made-up id never opens a bucket of its own).
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export function repositoryKey(request: Pick<FastifyRequest, 'params'>): string {
  const params: unknown = request.params;
  const githubRepoId =
    typeof params === 'object' && params !== null && 'githubRepoId' in params ? params.githubRepoId : undefined;
  return typeof githubRepoId === 'string' && REPOSITORY_ID.test(githubRepoId) ? `repo:${githubRepoId}` : 'repo:invalid';
}

/**
 * The failure of a request over a budget: `429 rate_limited`, with `Retry-After` set to the seconds until the budget has room again.
 * @throws AppError always.
 */
function tooManyRequests(reply: FastifyReply, retryAfterSeconds: number): never {
  // The reply is a thenable that settles when the response is sent: the result of `header` is dropped, never awaited.
  void reply.header('retry-after', String(retryAfterSeconds));
  throw new AppError(429, 'rate_limited');
}

/**
 * The `onRequest` hook of a public route: the budget of the client address first, then the one of the repository, so a client that
 * is over its own budget does not draw on the repository's. A request over either is `429 rate_limited` with `Retry-After`. Make it
 * once, after the rate-limit plugin is registered, and give the one hook to every public route.
 */
export function publicRateLimit(
  app: Pick<FastifyInstance, 'createRateLimit'>,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const byClient = app.createRateLimit(routeRateLimit(PUBLIC_RATE_LIMITS.perClient));
  const byRepository = app.createRateLimit({
    ...routeRateLimit(PUBLIC_RATE_LIMITS.perRepository),
    keyGenerator: repositoryKey,
  });
  return async (request, reply) => {
    for (const limit of [byClient, byRepository]) {
      const used = await limit(request);
      if (!used.isAllowed && used.isExceeded) {
        tooManyRequests(reply, used.ttlInSeconds);
      }
    }
  };
}
