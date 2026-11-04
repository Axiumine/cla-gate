// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { z } from 'zod';
import { setupStatusRoute, type setupStatusSchema } from '../../../shared/setup.ts';
import type { AppConfig } from '../../config/env.ts';
import type { Clock } from '../../services/ports/clock.ts';
import type { ManifestConversion } from '../../services/ports/manifest-conversion.ts';
import { createManifestConversion } from '../github/manifest-conversion.ts';
import { setNoStore } from './no-store.ts';
import { flowRoutes } from './setup-flow-routes.ts';
import { PUBLIC_NO_SESSION } from './setup-route-config.ts';
import { createSetupSessions, type SetupSessions } from './setup-sessions.ts';

// The first-run setup API (E19-S06). `GET /api/setup/status` is always there; the unlock and the manifest are registered in
// setup mode only (E19-S02: `setupToken` exists in that mode and no other), so a configured server answers `404` for them
// like for any path no route has. The conversion of GitHub's code into the credentials of the App (E19-S11) is the last of
// them.

export interface SetupRoutesOptions {
  /** The token of the setup mode, present in that mode only, and the origin the manifest and the `Origin` check are built on. */
  readonly config: Pick<AppConfig, 'setupToken' | 'publicBaseUrl'>;
  /** Where the idle time of a session and the failure windows take "now" from. */
  readonly clock: Clock;
  /** The sessions of the unlock. Defaults to an empty store on `clock`; a test passes its own to read what a route did to it. */
  readonly sessions?: SetupSessions | undefined;
  /** How the conversion reaches GitHub (E19-S11): the global `fetch` when none is given, which a test replaces. */
  readonly fetch?: typeof fetch | undefined;
  /** The ceiling of the conversion's call to GitHub; defaults to 10 seconds. */
  readonly githubTimeoutMs?: number | undefined;
  /** The conversion itself (E19-S11). Defaults to the one over `fetch`; a test passes its own to script what GitHub's side does. */
  readonly conversion?: ManifestConversion | undefined;
}

/** Everything a setup answer says is for the one browser that asked: no cache keeps it (the CSRF token and the `state` are in it). */
function noStore(_request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction): void {
  setNoStore(reply);
  done();
}

/**
 * The setup routes: `GET /api/setup/status` answers `{"mode":"setup"}` while the first-run flow is on offer and
 * `{"mode":"configured"}` otherwise, and only in setup mode are the unlock, the manifest and the conversion registered behind it.
 */
export const setupRoutes: FastifyPluginAsyncZod<SetupRoutesOptions> = async (app, options) => {
  app.addHook('onRequest', noStore);
  const { setupToken, publicBaseUrl } = options.config;
  app.get(
    setupStatusRoute.path,
    // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
    { schema: { response: setupStatusRoute.responses }, config: PUBLIC_NO_SESSION },
    (): z.infer<typeof setupStatusSchema> => ({ mode: setupToken === undefined ? 'configured' : 'setup' }),
  );
  if (setupToken !== undefined) {
    const sessions = options.sessions ?? createSetupSessions(options.clock);
    const conversion =
      options.conversion ?? createManifestConversion({ fetch: options.fetch, timeoutMs: options.githubTimeoutMs });
    await app.register(flowRoutes, { token: setupToken, publicBaseUrl, clock: options.clock, sessions, conversion });
  }
};
