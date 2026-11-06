// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import http from 'node:http';
import path from 'node:path';
import { collectIo } from '../ci/lib/test-support.ts';
import type { LeakDeps, MemlabOptions, MemlabResult } from './deps.ts';
import type { ExitTarget } from './exit-guard.ts';
import type { FixtureServer } from './fixture-server.ts';

// Test helpers for E20-S07: a scripted memlab, a process that records its exit handlers, and the fakes of the wrapper.

/** A trace as memlab serializes it: the bookkeeping key first, then one key per step. */
export function trace(...steps: string[]): Record<string, string> {
  const entries: [string, string][] = [
    ['$tabsOrder:[...]', 'tabs'],
    ...steps.map((step): [string, string] => [step, 'step']),
  ];
  return Object.fromEntries(entries);
}

/** A `process` that records its `exit` listeners and lets the test fire them. */
export function fakeProcess(): ExitTarget & {
  exitCode: number | string | null | undefined;
  fireExit: (code: number) => void;
} {
  const listeners: ((code: number) => void)[] = [];
  return {
    exitCode: undefined,
    on: (_event, listener) => listeners.push(listener),
    fireExit: (code) => {
      listeners.forEach((listener) => {
        listener(code);
      });
    },
  };
}

/** A scenario module, as `import()` returns it. */
export function scenarioModule(name: string): {
  default: { url: () => string; action: () => Promise<void>; back: () => Promise<void> };
} {
  return {
    default: {
      url: () => `http://127.0.0.1:40000/${name}.html`,
      action: () => Promise.resolve(),
      back: () => Promise.resolve(),
    },
  };
}

export interface Harness {
  readonly deps: LeakDeps;
  readonly out: string[];
  readonly err: string[];
  readonly process: ReturnType<typeof fakeProcess>;
  readonly env: Record<string, string | undefined>;
  /** What memlab was asked, with the origins of the fixtures and of the dashboard in the environment at that moment. */
  readonly memlabCalls: { options: MemlabOptions; origin: string | undefined; appOrigin: string | undefined }[];
  readonly madeDirectories: string[];
  readonly written: Map<string, string>;
  readonly loaded: string[];
  /** How many times the fixture server was started and closed. */
  readonly server: { started: number; closed: number };
  /** The same for the server of the dashboard (E18-S12). */
  readonly app: { started: number; closed: number };
}

export interface HarnessOptions {
  /** Files in the scenarios directory. */
  readonly listing?: readonly string[];
  /** What memlab answers for a scenario file name (without the extension); the default is no leak. */
  readonly memlab?: (name: string) => Promise<MemlabResult>;
  readonly load?: (file: string) => Promise<unknown>;
  readonly serve?: () => Promise<void>;
  readonly serveApp?: () => Promise<void>;
}

const NO_LEAKS: MemlabResult = { leaks: [] };

/** A server that counts its starts and closes in `count`, after `before` (which may refuse) has run. */
async function fakeServer(
  count: { started: number; closed: number },
  origin: string,
  before: (() => Promise<void>) | undefined,
): Promise<FixtureServer> {
  count.started += 1;
  await (before ?? (() => Promise.resolve()))();
  return {
    origin,
    close: () => {
      count.closed += 1;
      return Promise.resolve();
    },
  };
}

/** `LeakDeps` made of recording fakes; nothing touches the disk, a browser or a port. */
export function harness(options: HarnessOptions = {}): Harness {
  const { io, out, err } = collectIo();
  const process = fakeProcess();
  const env: Record<string, string | undefined> = {};
  const memlabCalls: Harness['memlabCalls'] = [];
  const madeDirectories: string[] = [];
  const written = new Map<string, string>();
  const loaded: string[] = [];
  const server = { started: 0, closed: 0 };
  const app = { started: 0, closed: 0 };
  const deps: LeakDeps = {
    io,
    env,
    process,
    cwd: '/work',
    places: {
      scenarios: '/repo/tests/leaks/scenarios',
      fixtures: '/repo/tests/leaks/fixtures',
      report: '/repo/reports/leaks',
    },
    chromiumBinary: '/browsers/chromium/chrome',
    memlab: (call) => {
      memlabCalls.push({ options: call, origin: env['LEAKS_ORIGIN'], appOrigin: env['LEAKS_APP_ORIGIN'] });
      // The work directory is <report>/<scenario name>/memlab.
      const name = path.basename(path.dirname(call.workDir));
      return (options.memlab ?? (() => Promise.resolve(NO_LEAKS)))(name);
    },
    load: (file) => {
      loaded.push(file);
      return (options.load ?? ((path: string) => Promise.resolve(scenarioModule(path))))(file);
    },
    files: {
      list: () => options.listing ?? ['canary.ts'],
      makeDirectory: (directory) => madeDirectories.push(directory),
      write: (file, text) => written.set(file, text),
    },
    serve: () => fakeServer(server, 'http://127.0.0.1:40123', options.serve),
    serveApp: () => fakeServer(app, 'http://127.0.0.1:40456', options.serveApp),
  };
  return { deps, out, err, process, env, memlabCalls, madeDirectories, written, loaded, server, app };
}

// E18-S12: shared by the tests of both loopback servers.

export interface Reply {
  readonly status: number | undefined;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: string;
}

/** A request with the path exactly as given: `fetch` and `URL` would resolve `..` before it leaves the process. */
export function request(origin: string, rawPath: string, method = 'GET'): Promise<Reply> {
  const { port } = new URL(origin);
  return new Promise((resolve, reject) => {
    const outgoing = http.request({ host: '127.0.0.1', port, path: rawPath, method }, (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
      incoming.on('end', () => {
        resolve({
          status: incoming.statusCode,
          headers: incoming.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}
