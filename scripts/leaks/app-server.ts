// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';
import { type FixtureServer, listenOnLoopback, send } from './fixture-server.ts';

// E18-S12: the dashboard the leak scenarios of the screens load. The built single-page app (`yarn build`) is served from its
// own files, and its API is answered from a fixed table of made-up bodies: the leak job has no database and no GitHub, and a
// leak is a property of the page, not of the server behind it. A loopback server on the port the caller picked, like the
// fixtures server of E20-S07.

/** What the app is served from and what its API says: the built web directory and the body of each `GET` path (no query). */
export interface AppSite {
  readonly root: string;
  readonly answers: ReadonlyMap<string, unknown>;
}

const CONTENT_TYPES: ReadonlyMap<string, string> = new Map([
  ['.html', 'text/html'],
  ['.js', 'text/javascript'],
  ['.css', 'text/css'],
  ['.svg', 'image/svg+xml'],
]);

/** One path segment of a built file: no dot first, no slash, no backslash, nothing that could climb out of the directory. */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ASSETS = 'assets';

/** A built file: where it is below the build directory, and the type it is served as. */
export interface BuiltFile {
  readonly file: string;
  readonly type: string;
}

/** The page of the app, which every address that is not a built file is answered with. */
const INDEX: BuiltFile = { file: 'index.html', type: 'text/html' };

/**
 * The built file a path names: `/<file>` or `/assets/<file>` with a known extension, or undefined. The path is never decoded, so
 * `%2e%2e` and `%2f` do not match a segment.
 */
export function staticFile(pathname: string): BuiltFile | undefined {
  const [empty, ...parts] = pathname.split('/');
  const inAssets = parts.length === 2 && parts[0] === ASSETS;
  if (empty !== '' || !(parts.length === 1 || inAssets) || !parts.every((part) => SEGMENT.test(part))) {
    return undefined;
  }
  const type = CONTENT_TYPES.get(path.extname(pathname));
  return type === undefined ? undefined : { file: parts.join('/'), type };
}

/** The path of a request address (the base only lets `URL` parse a path); `/` when the request has none. */
export function pathnameOf(url: string | undefined): string {
  return new URL(url ?? '/', 'https://app.invalid').pathname;
}

/** The standard error body of the API, as the app reads it, for a path that has no answer in the table. */
const NOT_FOUND = { error: { code: 'not_found', message: 'Not found.', requestId: 'leak-stub' } };

function readBuilt(root: string, file: string): Promise<string> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- `file` came from staticFile: one or two plain segments below the build directory
  return fs.promises.readFile(path.join(root, file), 'utf8');
}

function sendBuilt(root: string, built: BuiltFile, response: http.ServerResponse): void {
  readBuilt(root, built.file).then(
    (text) => {
      send(response, 200, built.type, text);
    },
    () => {
      send(response, 404, 'text/plain', 'not found');
    },
  );
}

function answerApi(site: AppSite, pathname: string, response: http.ServerResponse): void {
  const body = site.answers.get(pathname);
  if (body === undefined) {
    send(response, 404, 'application/json', JSON.stringify(NOT_FOUND));
  } else {
    send(response, 200, 'application/json', JSON.stringify(body));
  }
}

function answer(site: AppSite, request: http.IncomingMessage, response: http.ServerResponse): void {
  const pathname = pathnameOf(request.url);
  if (request.method !== 'GET') {
    send(response, 405, 'text/plain', 'method not allowed');
  } else if (pathname.startsWith('/api/')) {
    answerApi(site, pathname, response);
  } else {
    // Any other path is a screen of the single-page app: the router reads the address in the browser.
    sendBuilt(site.root, staticFile(pathname) ?? INDEX, response);
  }
}

/** Serves the built app and the API table of `site` on a loopback port from `pickPort`. */
export function serveApp(site: AppSite, pickPort: () => Promise<number>): Promise<FixtureServer> {
  return listenOnLoopback((request, response) => {
    answer(site, request, response);
  }, pickPort);
}
