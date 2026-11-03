// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { installUrlFor, META_CACHE_CONTROL, type MetaResponse, metaRoute } from '../../../shared/meta.ts';
import type { AppConfig } from '../../config/env.ts';

export interface MetaRoutesOptions {
  /** Where the source code is and which commit runs (`SOURCE_URL`, `SOURCE_COMMIT`). */
  readonly source: AppConfig['source'];
  /**
   * The slug of the GitHub App once the start-up self-check has verified it (E05-S02), read at each request because the
   * check can succeed after the server is listening; `undefined` while the App is not configured or not yet verified.
   */
  readonly appSlug: () => string | undefined;
}

/**
 * `GET /api/meta` (E17-S09): public, no session and no side effect. It tells the footer of every page where the corresponding
 * source of this running version is (AGPL section 13) and tells the dashboard where to install the App. The path and the
 * response schema are the descriptor's (`metaRoute`), the very value the web client calls it by. It is `public` (E11-S01:
 * the footer of the login page shows it too) and the session hook leaves it alone (`session: 'none'`), so it costs no query
 * and answers while the database is down.
 */
export const metaRoutes: FastifyPluginCallbackZod<MetaRoutesOptions> = (app, options, done) => {
  app.get(
    metaRoute.path,
    // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
    { schema: { response: metaRoute.responses }, config: { access: 'public', session: 'none' } },
    (_request, reply): MetaResponse => {
      void reply.header('cache-control', META_CACHE_CONTROL);
      const slug = options.appSlug();
      return {
        sourceUrl: options.source.url,
        commit: options.source.commit,
        installUrl: slug === undefined ? null : installUrlFor(slug),
      };
    },
  );
  done();
};
