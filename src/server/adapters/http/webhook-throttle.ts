// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from 'fastify';
import type { FailureThrottle } from '../../services/failure-throttle.ts';
import { AppError } from './errors.ts';

// The failed-signature throttle of the webhook route (E06-S07), as the two pieces of HTTP it needs: the guard that
// refuses an address that is held back before its body is read, and the answer to a failed verification, which becomes
// the throttle's `429` once the address has failed too often. The address is `request.ip`, so `TRUST_PROXY` (E04) decides
// which one that is; it goes into the throttle and nowhere else (not a log line, not a response, not the database).

/** The `429` of a held-back address: `Retry-After` is the whole seconds until its oldest counted failure leaves the window. */
function heldBack(reply: FastifyReply, seconds: number): AppError {
  // The reply is a thenable that settles when the response is sent: the result of `header` is dropped, never awaited.
  void reply.header('retry-after', String(seconds));
  return new AppError(429, 'webhook_throttled');
}

/**
 * The `onRequest` hook that turns away an address with too many failed verifications, whatever it sends now (a valid
 * delivery included): it runs before the body is read, so a flood costs one lookup and not a buffer and an HMAC.
 * A callback hook, not an async one: it awaits nothing.
 */
export function throttleGuard(throttle: FailureThrottle) {
  return (request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction): void => {
    const wait = throttle.retryAfter(request.ip);
    done(wait === undefined ? undefined : heldBack(reply, wait));
  };
}

/**
 * The answer to a signature that failed, whatever the cause: it counts as one failure of the address. `401` while the
 * address is within its limit, and `429` from the failure that takes it past it. Only failures reach this, so a valid
 * delivery never moves a counter.
 */
export function signatureFailure(throttle: FailureThrottle, request: FastifyRequest, reply: FastifyReply): AppError {
  const wait = throttle.recordFailure(request.ip);
  return wait === undefined ? new AppError(401, 'webhook_signature_invalid') : heldBack(reply, wait);
}
