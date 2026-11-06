// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { LOOPBACK } from '../ci/lib/ports.ts';

// E20-S07: the pages the leak scenarios load. A loopback `node:http` server on the port the caller picked (a random free
// one above 32768, never port 0, so the kernel's own range is not involved), reachable from this machine only.

export interface FixtureServer {
  /** `http://127.0.0.1:<port>`. */
  readonly origin: string;
  /** Closes the listener and every open connection; resolves once the port is free again. */
  readonly close: () => Promise<void>;
}

/** A flat, lower-case HTML file name: no slash, no dot except the extension, so no request can leave the fixtures directory. */
const FIXTURE_NAME = /^[a-z][a-z0-9-]*\.html$/;

/** The fixture a request path asks for, or undefined (the base only lets `URL` parse a path). The path is never decoded: `%2e%2e` and `%2f` do not match the pattern. */
export function fixtureName(url: string | undefined): string | undefined {
  const { pathname } = new URL(url ?? '/', 'https://fixtures.invalid');
  const name = pathname.slice(1);
  return FIXTURE_NAME.test(name) ? name : undefined;
}

/** Answers with `body` as `type`, never cached and never sniffed. */
export function send(response: http.ServerResponse, status: number, type: string, body: string): void {
  response.writeHead(status, {
    'content-type': `${type}; charset=utf-8`,
    // The pages are tiny and a stale copy would make a scenario measure something that is not on disk.
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

function readFixture(root: string, name: string): Promise<string> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- `name` matched FIXTURE_NAME: a flat HTML file name in the fixtures directory
  return fs.promises.readFile(path.join(root, name), 'utf8');
}

function answer(root: string, request: http.IncomingMessage, response: http.ServerResponse): void {
  const name = fixtureName(request.url);
  if (request.method !== 'GET') {
    send(response, 405, 'text/plain', 'method not allowed');
  } else if (name === undefined) {
    send(response, 404, 'text/plain', 'not found');
  } else {
    readFixture(root, name).then(
      (html) => {
        send(response, 200, 'text/html', html);
      },
      () => {
        send(response, 404, 'text/plain', 'not found');
      },
    );
  }
}

/**
 * Listens on a loopback port from `pickPort` (exclusive, so no other process shares it) and answers with `handle`. The
 * origin is known once the port is; `close` ends the listener and every open connection.
 */
export async function listenOnLoopback(
  handle: (request: http.IncomingMessage, response: http.ServerResponse) => void,
  pickPort: () => Promise<number>,
): Promise<FixtureServer> {
  const server = http.createServer(handle);
  const port = await pickPort();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen({ port, host: LOOPBACK, exclusive: true }, resolve);
  });
  return {
    origin: `http://${LOOPBACK}:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) {
            resolve();
          } else {
            reject(error);
          }
        });
        server.closeAllConnections();
      }),
  };
}

/** Serves the `*.html` files of `root` on a loopback port from `pickPort`. */
export function serveFixtures(root: string, pickPort: () => Promise<number>): Promise<FixtureServer> {
  return listenOnLoopback((request, response) => {
    answer(root, request, response);
  }, pickPort);
}
