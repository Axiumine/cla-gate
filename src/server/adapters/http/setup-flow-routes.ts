// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fastifyCookie from '@fastify/cookie';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Secret } from '../../config/secret.ts';
import type { Clock } from '../../services/ports/clock.ts';
import type { ManifestConversion } from '../../services/ports/manifest-conversion.ts';
import { convertRoute } from './setup-convert-route.ts';
import { manifestRoute } from './setup-manifest-route.ts';
import { sessionRoute } from './setup-session-route.ts';
import type { SetupSessions } from './setup-sessions.ts';
import { createUnlockThrottle } from './setup-throttle.ts';
import { unlockRoute } from './setup-unlock-route.ts';

export interface FlowOptions {
  readonly token: Secret;
  readonly publicBaseUrl: string;
  readonly clock: Clock;
  readonly sessions: SetupSessions;
  readonly conversion: ManifestConversion;
}

/**
 * The routes of setup mode: the unlock, the manifest, the read of the session's CSRF token (E19-S07) and the conversion
 * (E19-S11), with the cookie plugin they set and read the session cookie through, and the throttle on the wrong tokens that
 * only the unlock counts on.
 */
export const flowRoutes: FastifyPluginAsyncZod<FlowOptions> = async (app, options) => {
  await app.register(fastifyCookie);
  const { token, publicBaseUrl, sessions, conversion } = options;
  const origin = new URL(publicBaseUrl).origin;
  unlockRoute(app, { token, sessions, throttle: createUnlockThrottle(options.clock) });
  manifestRoute(app, { publicBaseUrl, sessions, origin });
  sessionRoute(app, { sessions });
  convertRoute(app, { sessions, origin, conversion });
};
