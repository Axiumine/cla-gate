// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyInstance } from 'fastify';
import type { TrustProxy } from '../../config/trust-proxy.ts';
import type { Clock } from '../../services/ports/clock.ts';

// The sign of a reverse proxy that `TRUST_PROXY` does not know about (E10-S08). Behind one, with the setting at its
// default, every user arrives from the proxy's address and the rate limit would count them all together.

/** The warning is logged at most once in this long. */
const WARN_INTERVAL_MS = 60_000;

interface ProxyWarningOptions {
  readonly trustProxy: TrustProxy;
  /** Where the once-a-minute limit takes "now" from. */
  readonly clock: Clock;
}

/**
 * While `TRUST_PROXY` is `false`, logs the warning `trust_proxy_suspected` for a request that carries `X-Forwarded-For`
 * or `Forwarded`, at most once a minute for the whole process. The log line holds neither the client address nor the
 * header's value (network metadata is not recorded), and no header is parsed. With any other setting nothing is registered.
 */
export function warnWhenProxyIsSuspected(app: FastifyInstance, options: ProxyWarningOptions): void {
  if (options.trustProxy !== false) {
    return;
  }
  let lastWarnedAt: number | undefined;
  app.addHook('onRequest', (request, _reply, done) => {
    // Presence is all that is looked at; the values of these headers are never read.
    const { 'x-forwarded-for': forwardedFor, forwarded } = request.headers;
    if (forwardedFor !== undefined || forwarded !== undefined) {
      const now = options.clock.now().getTime();
      if (lastWarnedAt === undefined || now - lastWarnedAt >= WARN_INTERVAL_MS) {
        lastWarnedAt = now;
        request.log.warn(
          { hint: 'a proxy header arrived while TRUST_PROXY is false: behind a reverse proxy set TRUST_PROXY' },
          'trust_proxy_suspected',
        );
      }
    }
    done();
  });
}
