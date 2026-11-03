// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { z } from 'zod';
import { manifestRequestSchema, type manifestResponseSchema, setupManifestRoute } from '../../../shared/setup.ts';
import { buildAppManifest, manifestActionUrl } from '../../domain/app-manifest.ts';
import { SETUP_BODY_LIMIT } from './limits.ts';
import { parseInput } from './request-body.ts';
import { requireSetupSession, type SetupGuardDeps } from './setup-guard.ts';
import { SETUP_POST } from './setup-route-config.ts';

/** The instance the route is registered on: Fastify with the zod type provider. */
type Routes = Parameters<FastifyPluginCallbackZod>[0];

export interface ManifestRouteOptions extends SetupGuardDeps {
  /** `PUBLIC_BASE_URL`: the address every URL of the manifest is built on. */
  readonly publicBaseUrl: string;
}

/**
 * `POST /api/setup/manifest` (E19-S06): needs the setup session (cookie, CSRF token and `Origin`, see
 * {@link requireSetupSession}, checked before the body is read) and answers with the manifest, the address to post it to and
 * a `state` that belongs to that session alone and replaces the one it had. The body is read by `parseInput`, so anything
 * the request schema refuses is a `400` before the manifest or the address is built. The `state` and the session are never logged.
 */
export function manifestRoute(app: Routes, options: ManifestRouteOptions): void {
  app.post(
    setupManifestRoute.path,
    // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
    { bodyLimit: SETUP_BODY_LIMIT, schema: { response: setupManifestRoute.responses }, config: SETUP_POST },
    (request, reply): z.infer<typeof manifestResponseSchema> => {
      const session = requireSetupSession(request, reply, options);
      const body = parseInput(manifestRequestSchema, request.body);
      const state = options.sessions.issueState(session);
      const manifest = buildAppManifest({
        publicBaseUrl: options.publicBaseUrl,
        appName: body.appName,
        allowOtherAccounts: body.allowOtherAccounts,
      });
      return { actionUrl: manifestActionUrl(body, state), manifest, state };
    },
  );
}
