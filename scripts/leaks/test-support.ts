// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { collectIo } from '../ci/lib/test-support.ts';
import type { LeakDeps, MemlabOptions, MemlabResult } from './deps.ts';
import type { ExitTarget } from './exit-guard.ts';

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
  /** What memlab was asked, with the fixture origin in the environment at that moment. */
  readonly memlabCalls: { options: MemlabOptions; origin: string | undefined }[];
  readonly madeDirectories: string[];
  readonly written: Map<string, string>;
  readonly loaded: string[];
  /** How many times the fixture server was started and closed. */
  readonly server: { started: number; closed: number };
}

export interface HarnessOptions {
  /** Files in the scenarios directory. */
  readonly listing?: readonly string[];
  /** What memlab answers for a scenario file name (without the extension); the default is no leak. */
  readonly memlab?: (name: string) => Promise<MemlabResult>;
  readonly load?: (file: string) => Promise<unknown>;
  readonly serve?: () => Promise<void>;
}

const NO_LEAKS: MemlabResult = { leaks: [] };

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
      memlabCalls.push({ options: call, origin: env['LEAKS_ORIGIN'] });
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
    serve: async () => {
      server.started += 1;
      await (options.serve ?? (() => Promise.resolve()))();
      return {
        origin: 'http://127.0.0.1:40123',
        close: () => {
          server.closed += 1;
          return Promise.resolve();
        },
      };
    },
  };
  return { deps, out, err, process, env, memlabCalls, madeDirectories, written, loaded, server };
}
