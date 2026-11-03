// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import fastifyStatic, { type FastifyStaticOptions } from '@fastify/static';
import type { FastifyBaseLogger, FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { WEBHOOK_PATH } from '../../../shared/routes.ts';
import type { AppConfig } from '../../config/env.ts';
import { AppError } from './errors.ts';
import { decodedPathname, isSetupUrl } from './spa-url.ts';

// Serving the single-page app from the API's own origin (E17-S03): the files of `dist/web`, the `index.html` that every
// route of the app falls back to, and the cache rules of both. No CORS plugin is registered anywhere, so a page on another
// origin cannot read what this one answers.

const INDEX = 'index.html';

/** The directory of the content-hashed files that Vite emits: the name changes with the content, so a copy never goes stale. */
const ASSETS = 'assets';
const IMMUTABLE = 'public, max-age=31536000, immutable';
/** Cached, but checked with the server (its ETag) before every use: `index.html` names the hashed files, so it must stay fresh. */
const REVALIDATE = 'no-cache';

/** What belongs to the server and never to the app: its answers are JSON, so a miss under these is a 404 and never `index.html`. */
const SERVER_PATHS = ['/api', '/healthz', '/readyz', WEBHOOK_PATH];

/** Whether a decoded path is one of {@link SERVER_PATHS} or below one (`/api/x`, not `/apix`). Not case-sensitive, so no spelling slips through. */
function isServerPath(pathname: string): boolean {
  const lower = pathname.toLowerCase();
  return SERVER_PATHS.some((base) => lower === base || lower.startsWith(`${base}/`));
}

/** A segment that starts with a dot names a file (a hidden one), never a page of the app; such a file is denied (see {@link staticOptions}). */
function hasDotSegment(pathname: string): boolean {
  return pathname.split('/').some((segment) => segment.startsWith('.'));
}

/** The path of a page of the app: not the server's, no dotfile in it and no file extension. */
function isPagePath(pathname: string): boolean {
  return !isServerPath(pathname) && !hasDotSegment(pathname) && path.posix.extname(pathname) === '';
}

type Target = Pick<FastifyRequest, 'url' | 'method' | 'headers'>;

/**
 * Whether a request is for a page of the app: a GET or HEAD for a path of the app from a client that accepts HTML, which
 * is a page the app routes in the browser. Anything else, a missing `/assets/x.js` and every other method included, gets
 * the standard 404 body.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export function isAppPage(request: Target): boolean {
  const pathname = decodedPathname(request.url);
  const reads = request.method === 'GET' || request.method === 'HEAD';
  const html = (request.headers.accept ?? '').toLowerCase().includes('text/html');
  return reads && html && pathname !== undefined && isPagePath(pathname);
}

/**
 * The options of `@fastify/static`: our cache rules, no listing (the default), and dotfiles denied by answering for them as
 * for a file that is not there (404, like a path that leaves the root: the library reads a `..` that is not a whole
 * segment, as in `/assets/..%2f..%2fpackage.json`, as a dotfile).
 */
function staticOptions(root: string): FastifyStaticOptions {
  return {
    root,
    index: INDEX,
    dotfiles: 'ignore',
    // Cache-Control is ours, set below; ETag and Last-Modified are the library's.
    cacheControl: false,
    setHeaders: (reply, file) => {
      const [top] = path.relative(root, file).split(path.sep);
      // The reply is a thenable that settles when the response is sent: the result of `header` is dropped, never awaited.
      void reply.header('cache-control', top === ASSETS ? IMMUTABLE : REVALIDATE);
    },
  };
}

/**
 * What the file routes declare: nobody is asked who they are (`access: 'public'`, E11-S01: the page and its files are the same
 * for everyone, and the API behind them has its own declarations) and they never read the session, so a page of the app
 * loads while the database is down.
 */
const PUBLIC_NO_SESSION: { readonly access: 'public'; readonly session: 'none' } = {
  access: 'public',
  session: 'none',
};

/**
 * The routes of the files (`GET` and `HEAD` of every path that no other route has), in a scope of their own so that the
 * hooks below reach no other route. The pages of the app are answered by a `preHandler` hook, which runs after the rate
 * limit (an `onRequest` hook of the route): `index.html` is sent for them whether or not a file of that name exists. The
 * `reply.sendFile` it uses is the one that `@fastify/static` gives this scope.
 */
const fileRoutes: FastifyPluginAsync<{ readonly root: string; readonly hideSetup: boolean }> = async (
  scope,
  { root, hideSetup },
) => {
  scope.addHook('onRoute', (route) => {
    route.config = { ...route.config, ...PUBLIC_NO_SESSION };
    // The library answers a directory or a path it refuses with `reply.callNotFound()` and then resolves with nothing. The 404
    // is sent after the `preHandler` hooks of the app have run again for it, and one of them is async (the access guard of
    // E11-S01), so the 404 comes after the handler has resolved and Fastify would send an empty 200 first. Resolving with the
    // reply makes Fastify wait until the reply is sent, whoever sends it.
    const serve = route.handler;
    route.handler = async (request, reply) => {
      await serve.call(scope, request, reply);
      return reply;
    };
  });
  // Async on purpose: a Fastify hook that sends a reply hands the reply back (it resolves when the file has gone out); a sync two-argument hook would never finish.
  // While the GitHub App is configured the setup page does not exist (E19-S06): its paths get the standard 404, not the app.
  scope.addHook('preHandler', async (request, reply) => {
    if (hideSetup && isSetupUrl(request.url)) {
      throw new AppError(404, 'not_found');
    }
    return isAppPage(request) ? reply.sendFile(INDEX) : undefined;
  });
  await scope.register(fastifyStatic, staticOptions(root));
};

/**
 * The directory to serve, or undefined when the server serves no app: in development the Vite dev server does, and a
 * directory without an `index.html` is no build (it is logged, so an image that forgot `dist/web` is not a silent 404).
 */
function webRootToServe(config: Pick<AppConfig, 'nodeEnv' | 'webRoot'>, logger: FastifyBaseLogger): string | undefined {
  if (config.nodeEnv === 'development') {
    return undefined;
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the operator's WEB_ROOT, checked once at start-up for the file the app is served from
  const index = fs.statSync(path.join(config.webRoot, INDEX), { throwIfNoEntry: false });
  if (index?.isFile() !== true) {
    logger.warn({ webRoot: config.webRoot }, 'web.not_served');
    return undefined;
  }
  logger.info({ webRoot: config.webRoot }, 'web.serving');
  return config.webRoot;
}

/**
 * Serves the single-page app from `config.webRoot` (see {@link webRootToServe} for when it does not): its files from every
 * path that no route of the API answers, and `index.html` for the pages of the app, except the setup page and what is below
 * it while the GitHub App is configured, which get the standard `404` (E19-S06). Call it after the routes of the API, so that
 * its wildcard never shadows one (an exact route always wins anyway).
 */
export async function registerWeb(
  app: FastifyInstance,
  config: Pick<AppConfig, 'nodeEnv' | 'webRoot' | 'mode'>,
): Promise<void> {
  const root = webRootToServe(config, app.log);
  if (root !== undefined) {
    await app.register(fileRoutes, { root, hideSetup: config.mode === 'normal' });
  }
}
